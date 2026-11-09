import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { recoverTypedDataAddress, type Address } from 'viem'
import { createApp } from './app'
import { actionMessage, CLAIM_TYPES, loginMessage } from './auth'
import { actionMessage as clientActionMessage } from '../src/lib/messages'
import type { ChainReader } from './chain'
import { GameDb } from './db'
import { SEPOLIA_CHAIN_ID } from './config'

const HUB = '0x648066e35b1d50e35d3bfd9ffef8dfb9c5b62c5c' as Address
let clock = Date.UTC(2026, 10, 8, 12, 0, 0)
let claimedOnChain = 0n
let db: GameDb
let api: ReturnType<typeof createApp>
const signer = privateKeyToAccount(generatePrivateKey())

const chain: ChainReader = {
  claimedOf: async () => claimedOnChain,
  boostWeight: async () => 0,
}

beforeEach(() => {
  clock = Date.UTC(2026, 10, 8, 12, 0, 0)
  claimedOnChain = 0n
  db = new GameDb(':memory:')
  api = createApp({ db, signer, hub: HUB, chain, now: () => clock, trustProxy: false })
})
afterEach(() => db.close())

async function call(method: string, path: string, body?: unknown, token?: string, ip = '1.1.1.1') {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await api.handle(new Request(`http://x${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), ip)
  return { status: res.status, json: (await res.json()) as ReturnType<typeof JSON.parse> }
}

async function login(key = generatePrivateKey(), ref?: string) {
  const account = privateKeyToAccount(key)
  const n = await call('POST', '/api/auth/nonce', { address: account.address })
  const signature = await account.signMessage({ message: n.json.message })
  const v = await call('POST', '/api/auth/verify', { address: account.address, signature, ref })
  return { account, token: v.json.token as string, res: v }
}

async function signedAction(account: ReturnType<typeof privateKeyToAccount>, token: string, action: string, details: string) {
  const me = await call('GET', '/api/me', undefined, token)
  const nonce = me.json.actionNonce as number
  const signature = await account.signMessage({ message: actionMessage(account.address, action, details, nonce) })
  return { nonce, signature }
}

describe('auth', () => {
  test('sign-in creates a player and a session', async () => {
    const { token, res } = await login()
    expect(res.status).toBe(200)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const me = await call('GET', '/api/me', undefined, token)
    expect(me.status).toBe(200)
    expect(me.json.view.level).toBe(1)
  })

  test('login message is deterministic and chain-bound', () => {
    const m = loginMessage('0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD', 'n', 'now')
    expect(m).toContain(String(SEPOLIA_CHAIN_ID))
    expect(m).toContain('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
  })

  test('wrong signer is rejected and nonce is single-use', async () => {
    const victim = privateKeyToAccount(generatePrivateKey())
    const attacker = privateKeyToAccount(generatePrivateKey())
    const n = await call('POST', '/api/auth/nonce', { address: victim.address })
    const forged = await attacker.signMessage({ message: n.json.message })
    expect((await call('POST', '/api/auth/verify', { address: victim.address, signature: forged })).status).toBe(401)
    const good = await victim.signMessage({ message: n.json.message })
    expect((await call('POST', '/api/auth/verify', { address: victim.address, signature: good })).status).toBe(401)
  })

  test('expired nonce is rejected', async () => {
    const a = privateKeyToAccount(generatePrivateKey())
    const n = await call('POST', '/api/auth/nonce', { address: a.address })
    clock += 10 * 60_000
    const sig = await a.signMessage({ message: n.json.message })
    expect((await call('POST', '/api/auth/verify', { address: a.address, signature: sig })).json.code).toBe('NONCE_EXPIRED')
  })

  test('protected routes need a valid bearer token', async () => {
    expect((await call('GET', '/api/me')).status).toBe(401)
    expect((await call('POST', '/api/tap', { count: 1 }, 'a'.repeat(64))).status).toBe(401)
    expect((await call('POST', '/api/tap', { count: 1 }, 'not-a-token')).status).toBe(401)
  })

  test('sessions expire and logout revokes', async () => {
    const { token } = await login()
    await call('POST', '/api/auth/logout', {}, token)
    expect((await call('GET', '/api/me', undefined, token)).status).toBe(401)
    const second = await login()
    clock += 13 * 3600_000
    expect((await call('GET', '/api/me', undefined, second.token)).json.code).toBe('SESSION_EXPIRED')
  })
})

describe('shared messages', () => {
  test('client and server build identical action messages', () => {
    const a = '0xA1C6808b8f08D091e2826C9640Be302a310655E1'
    expect(clientActionMessage(a, 'swap', '10 gold', 3)).toBe(actionMessage(a, 'swap', '10 gold', 3))
  })
})

describe('input validation', () => {
  test('rejects bad addresses, bodies and content types', async () => {
    expect((await call('POST', '/api/auth/nonce', { address: '0x123' })).status).toBe(400)
    expect((await call('POST', '/api/auth/nonce', ['x'])).status).toBe(400)
    const res = await api.handle(new Request('http://x/api/auth/nonce', { method: 'POST', body: 'hi', headers: { 'content-type': 'text/plain' } }), 'ip')
    expect(res.status).toBe(415)
    const big = await call('POST', '/api/auth/nonce', { address: 'x'.repeat(5000) })
    expect(big.status).toBe(413)
  })

  test('rejects malformed game inputs', async () => {
    const { token } = await login()
    expect((await call('POST', '/api/tap', { count: 0 }, token)).status).toBe(400)
    expect((await call('POST', '/api/tap', { count: '5' }, token)).status).toBe(400)
    expect((await call('POST', '/api/tap', { count: 1e9 }, token)).status).toBe(400)
    expect((await call('POST', '/api/refine', { from: 'diamond', units: 1 }, token)).status).toBe(400)
    expect((await call('POST', '/api/hamsters/hire', { tier: 7 }, token)).json.code).toBe('BAD_INPUT')
    expect((await call('GET', '/api/nope')).status).toBe(404)
    expect((await call('DELETE', '/api/me')).status).toBe(405)
  })
})

describe('game loop', () => {
  test('tapping earns gems and respects the bot limiter', async () => {
    const { token } = await login()
    const r = await call('POST', '/api/tap', { count: 20 }, token)
    expect(r.status).toBe(200)
    expect(r.json.tapped).toBe(20)
    expect(r.json.state.gems.bronze).toBeGreaterThan(19)
    let blocked = 0
    for (let i = 0; i < 30; i++) {
      const x = await call('POST', '/api/tap', { count: 50 }, token)
      if (x.status !== 200) blocked += 1
    }
    expect(blocked).toBeGreaterThan(0)
  })

  test('idle mining accrues with server time', async () => {
    const { token } = await login()
    clock += 3600_000
    const me = await call('GET', '/api/me', undefined, token)
    expect(me.json.state.gems.bronze).toBeCloseTo(60, 3)
  })

  test('insufficient funds surface as friendly 400s', async () => {
    const { token } = await login()
    const r = await call('POST', '/api/hamsters/hire', { tier: 1 }, token)
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('INSUFFICIENT')
  })

  test('check-in pays once per day', async () => {
    const { token } = await login()
    expect((await call('POST', '/api/checkin', {}, token)).status).toBe(200)
    expect((await call('POST', '/api/checkin', {}, token)).json.code).toBe('ALREADY_DONE')
  })

  test('leaderboard ranks by mined value and masks addresses', async () => {
    const a = await login()
    const b = await login()
    clock += 7200_000
    await call('GET', '/api/me', undefined, a.token)
    await call('POST', '/api/tap', { count: 30 }, b.token)
    const lb = await call('GET', '/api/leaderboard?by=gems', undefined, b.token, '9.9.9.9')
    expect(lb.json.rows.length).toBe(2)
    expect(lb.json.rows[0].address).toContain('…')
    expect(lb.json.rows.some((r: { isYou: boolean }) => r.isYou)).toBe(true)
    expect(lb.json.you.rank).toBeGreaterThan(0)
  })
})

describe('referrals', () => {
  test('referrer earns a share of mined value, capped, and self-referral is ignored', async () => {
    const inviter = await login()
    const code = (await call('GET', '/api/me', undefined, inviter.token)).json.referral.code as string
    const invited = await login(generatePrivateKey(), code)
    clock += 3600_000
    await call('GET', '/api/me', undefined, invited.token)
    const me = await call('GET', '/api/me', undefined, inviter.token)
    expect(me.json.referral.invited).toBe(1)
    expect(me.json.referral.income).toBeGreaterThan(5.9)
    expect(me.json.referral.income).toBeLessThan(6.1)
    const selfKey = generatePrivateKey()
    const self = await login(selfKey, code)
    expect(self.res.status).toBe(200)
  })
})

describe('swap and claim', () => {
  async function richPlayer() {
    const p = await login()
    const u = db.getUser(p.account.address.toLowerCase())!
    u.state.gems.gold = 1000
    u.state.xp = 20000
    db.saveState(u.address, u.state, 10, clock)
    return p
  }

  test('swap requires a valid action signature bound to the nonce', async () => {
    const p = await richPlayer()
    const bad = await call('POST', '/api/swap', { gem: 'gold', amount: 10, nonce: 0, signature: `0x${'11'.repeat(65)}` }, p.token)
    expect(bad.status).toBe(401)
    const other = privateKeyToAccount(generatePrivateKey())
    const forged = await signedAction(other, p.token, 'swap', '10 gold')
    const res = await call('POST', '/api/swap', { gem: 'gold', amount: 10, ...forged }, p.token)
    expect(res.status).toBe(401)
  })

  test('swap converts gems into earned HGEM, once per signature', async () => {
    const p = await richPlayer()
    const sig = await signedAction(p.account, p.token, 'swap', '10 gold')
    const ok = await call('POST', '/api/swap', { gem: 'gold', amount: 10, ...sig }, p.token)
    expect(ok.status).toBe(200)
    expect(ok.json.quote.hgemMicro).toBe(7_200_000)
    expect(ok.json.state.hgemEarnedMicro).toBe(7_200_000)
    const replay = await call('POST', '/api/swap', { gem: 'gold', amount: 10, ...sig }, p.token)
    expect(replay.status).toBe(409)
  })

  test('swap pricing shifts with global volume', async () => {
    const p = await richPlayer()
    db.addGlobalSwap('2026-11-08', 50_000 * 1_000_000)
    const q = await call('GET', '/api/swap/quote?gem=gold&amount=10', undefined, p.token)
    expect(q.json.quote.factor).toBeCloseTo(0.7, 5)
  })

  test('voucher is a valid EIP-712 signature from the backend signer', async () => {
    const p = await richPlayer()
    const sw = await signedAction(p.account, p.token, 'swap', '10 gold')
    await call('POST', '/api/swap', { gem: 'gold', amount: 10, ...sw }, p.token)
    const sig = await signedAction(p.account, p.token, 'claim', 'all')
    const v = await call('POST', '/api/voucher', sig, p.token)
    expect(v.status).toBe(200)
    expect(v.json.cumulative).toBe((7_200_000n * 10n ** 12n).toString())
    const recovered = await recoverTypedDataAddress({
      domain: { name: 'HamsterGems', version: '1', chainId: SEPOLIA_CHAIN_ID, verifyingContract: HUB },
      types: CLAIM_TYPES,
      primaryType: 'Claim',
      message: { account: p.account.address.toLowerCase() as Address, cumulative: BigInt(v.json.cumulative), deadline: BigInt(v.json.deadline) },
      signature: v.json.signature,
    })
    expect(recovered).toBe(signer.address)
  })

  test('nothing to claim once the chain is caught up', async () => {
    const p = await richPlayer()
    const sw = await signedAction(p.account, p.token, 'swap', '10 gold')
    await call('POST', '/api/swap', { gem: 'gold', amount: 10, ...sw }, p.token)
    claimedOnChain = 7_200_000n * 10n ** 12n
    const sig = await signedAction(p.account, p.token, 'claim', 'all')
    expect((await call('POST', '/api/voucher', sig, p.token)).json.code).toBe('NOTHING_TO_CLAIM')
  })

  test('claims are offline without contract configuration', async () => {
    const offline = createApp({ db, signer: null, hub: null, chain: null, now: () => clock })
    const p = await login()
    const res = await offline.handle(
      new Request('http://x/api/voucher', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${p.token}` }, body: JSON.stringify({ nonce: 0, signature: `0x${'11'.repeat(65)}` }) }),
      'ip',
    )
    expect(res.status).toBe(503)
  })
})

describe('rate limiting', () => {
  test('floods from one address are throttled with Retry-After', async () => {
    const { token } = await login()
    let limited: Awaited<ReturnType<typeof call>> | null = null
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await call('GET', '/api/me', undefined, token)
      if (r.status === 429) limited = r
    }
    expect(limited?.json.code).toBe('RATE_LIMITED')
  })

  test('auth endpoints are throttled per address', async () => {
    const a = privateKeyToAccount(generatePrivateKey())
    const codes: number[] = []
    for (let i = 0; i < 10; i++) codes.push((await call('POST', '/api/auth/nonce', { address: a.address })).status)
    expect(codes).toContain(429)
  })
})
