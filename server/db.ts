/** SQLite persistence. One process owns the file; WAL + synchronous FULL for crash safety. */
import { Database } from 'bun:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { newPlayer } from '../src/game/engine'
import type { PlayerState } from '../src/game/types'
import { SESSION_TTL_MS } from './config'

export interface UserRow {
  address: string
  refCode: string
  referrer: string | null
  state: PlayerState
  actionNonce: number
  refIncome: number
  createdAt: number
}

interface RawUser {
  address: string
  ref_code: string
  referrer: string | null
  state: string
  action_nonce: number
  ref_income: number
  created_at: number
}

export interface LeaderRow {
  address: string
  xp: number
  total_mined: number
  hash_power: number
}

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function makeCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (const b of bytes) out += CODE_ALPHABET[b % 32]
  return out
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export class GameDb {
  readonly db: Database

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path, { create: true })
    this.db.run('PRAGMA journal_mode=WAL')
    this.db.run('PRAGMA synchronous=FULL')
    this.db.run('PRAGMA busy_timeout=5000')
    this.db.run(`CREATE TABLE IF NOT EXISTS users (
      address TEXT PRIMARY KEY,
      ref_code TEXT NOT NULL UNIQUE,
      referrer TEXT,
      state TEXT NOT NULL,
      xp INTEGER NOT NULL DEFAULT 0,
      total_mined REAL NOT NULL DEFAULT 0,
      hash_power INTEGER NOT NULL DEFAULT 0,
      action_nonce INTEGER NOT NULL DEFAULT 0,
      ref_income REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    this.db.run('CREATE INDEX IF NOT EXISTS idx_users_mined ON users(total_mined DESC)')
    this.db.run('CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC)')
    this.db.run('CREATE INDEX IF NOT EXISTS idx_users_referrer ON users(referrer)')
    this.db.run('CREATE TABLE IF NOT EXISTS nonces (address TEXT PRIMARY KEY, nonce TEXT NOT NULL, issued_at INTEGER NOT NULL, expires INTEGER NOT NULL)')
    this.db.run('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, expires INTEGER NOT NULL)')
    this.db.run('CREATE TABLE IF NOT EXISTS global_daily (day TEXT PRIMARY KEY, swapped_micro INTEGER NOT NULL DEFAULT 0)')
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  /* --------------------------------------------------------------- users */

  private toRow(raw: RawUser): UserRow {
    return {
      address: raw.address,
      refCode: raw.ref_code,
      referrer: raw.referrer,
      state: JSON.parse(raw.state) as PlayerState,
      actionNonce: raw.action_nonce,
      refIncome: raw.ref_income,
      createdAt: raw.created_at,
    }
  }

  getUser(address: string): UserRow | null {
    const raw = this.db.query('SELECT * FROM users WHERE address = ?').get(address) as RawUser | null
    return raw ? this.toRow(raw) : null
  }

  userByCode(code: string): UserRow | null {
    const raw = this.db.query('SELECT * FROM users WHERE ref_code = ?').get(code) as RawUser | null
    return raw ? this.toRow(raw) : null
  }

  createUser(address: string, referrerAddress: string | null, now: number): UserRow {
    let code = makeCode()
    while (this.db.query('SELECT 1 FROM users WHERE ref_code = ?').get(code)) code = makeCode()
    const state = newPlayer(now)
    this.db
      .query(
        'INSERT INTO users (address, ref_code, referrer, state, xp, total_mined, hash_power, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 10, ?, ?)',
      )
      .run(address, code, referrerAddress, JSON.stringify(state), now, now)
    const created = this.getUser(address)
    if (!created) throw new Error('user insert failed')
    return created
  }

  saveState(address: string, state: PlayerState, hashPower: number, now: number): void {
    this.db
      .query('UPDATE users SET state = ?, xp = ?, total_mined = ?, hash_power = ?, updated_at = ? WHERE address = ?')
      .run(JSON.stringify(state), state.xp, state.totalMined, hashPower, now, address)
  }

  bumpActionNonce(address: string): void {
    this.db.query('UPDATE users SET action_nonce = action_nonce + 1 WHERE address = ?').run(address)
  }

  addRefIncome(address: string, amount: number): void {
    this.db.query('UPDATE users SET ref_income = ref_income + ? WHERE address = ?').run(amount, address)
  }

  countReferrals(address: string): number {
    const row = this.db.query('SELECT COUNT(*) AS c FROM users WHERE referrer = ?').get(address) as { c: number }
    return row.c
  }

  leaderboard(by: 'gems' | 'xp', limit: number): LeaderRow[] {
    const order = by === 'xp' ? 'xp DESC, total_mined DESC' : 'total_mined DESC, xp DESC'
    return this.db
      .query(`SELECT address, xp, total_mined, hash_power FROM users ORDER BY ${order} LIMIT ?`)
      .all(limit) as LeaderRow[]
  }

  rankOf(address: string, by: 'gems' | 'xp'): number {
    const column = by === 'xp' ? 'xp' : 'total_mined'
    const me = this.db.query(`SELECT ${column} AS v FROM users WHERE address = ?`).get(address) as { v: number } | null
    if (!me) return 0
    const row = this.db.query(`SELECT COUNT(*) AS c FROM users WHERE ${column} > ?`).get(me.v) as { c: number }
    return row.c + 1
  }

  userCount(): number {
    return (this.db.query('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c
  }

  /* ----------------------------------------------------------- auth data */

  putNonce(address: string, nonce: string, issuedAt: number, expires: number): void {
    this.db
      .query('INSERT INTO nonces (address, nonce, issued_at, expires) VALUES (?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET nonce = excluded.nonce, issued_at = excluded.issued_at, expires = excluded.expires')
      .run(address, nonce, issuedAt, expires)
  }

  /** Single-use: returns and deletes the pending nonce. */
  takeNonce(address: string, now: number): { nonce: string; issuedAt: number } | null {
    const row = this.db.query('SELECT nonce, issued_at, expires FROM nonces WHERE address = ?').get(address) as
      | { nonce: string; issued_at: number; expires: number }
      | null
    this.db.query('DELETE FROM nonces WHERE address = ?').run(address)
    if (!row || row.expires < now) return null
    return { nonce: row.nonce, issuedAt: row.issued_at }
  }

  createSession(address: string, now: number): string {
    const token = randomBytes(32).toString('hex')
    this.db
      .query('INSERT INTO sessions (token_hash, address, expires) VALUES (?, ?, ?)')
      .run(sha256(token), address, now + SESSION_TTL_MS)
    return token
  }

  sessionAddress(token: string, now: number): string | null {
    const row = this.db.query('SELECT address, expires FROM sessions WHERE token_hash = ?').get(sha256(token)) as
      | { address: string; expires: number }
      | null
    if (!row || row.expires < now) return null
    return row.address
  }

  deleteSession(token: string): void {
    this.db.query('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
  }

  prune(now: number): void {
    this.db.query('DELETE FROM sessions WHERE expires < ?').run(now)
    this.db.query('DELETE FROM nonces WHERE expires < ?').run(now)
  }

  /* -------------------------------------------------------- global swaps */

  globalSwapMicro(day: string): number {
    const row = this.db.query('SELECT swapped_micro AS v FROM global_daily WHERE day = ?').get(day) as { v: number } | null
    return row?.v ?? 0
  }

  addGlobalSwap(day: string, micro: number): void {
    this.db
      .query('INSERT INTO global_daily (day, swapped_micro) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET swapped_micro = swapped_micro + excluded.swapped_micro')
      .run(day, micro)
  }

  close(): void {
    this.db.run('PRAGMA wal_checkpoint(TRUNCATE)')
    this.db.close()
  }
}
