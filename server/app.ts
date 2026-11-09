/** HTTP API. `createApp` is pure of globals so tests can inject a database, clock, signer and chain reader. */
import type { Address } from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { randomBytes } from 'node:crypto'
import {
  GEMS,
  GEM_IDS,
  QUESTS,
  REFERRAL_DAILY_CAP_BRONZE,
  REFERRAL_SHARE,
  SWAP_BASE_HGEM_PER_BRONZE,
  SWAP_GLOBAL_DAILY_CAP_MICRO,
  GEM_VALUE,
} from '../src/game/config'
import {
  checkIn,
  claimQuest,
  creditReferral,
  hashPower,
  hire,
  questProgress,
  quoteSwap,
  refine,
  settle,
  stakeBoostFromWeight,
  swap,
  swapFactor,
  tap,
  upgrade,
  userSwapCapMicro,
  utcDay,
  viewOf,
} from '../src/game/engine'
import { GameError, type EngineContext, type PlayerState } from '../src/game/types'
import { loginMessage, recoverSigner, signVoucher, verifyAction } from './auth'
import type { ChainReader } from './chain'
import { NONCE_TTL_MS, SEPOLIA_CHAIN_ID, VOUCHER_TTL_SEC } from './config'
import type { GameDb, UserRow } from './db'
import {
  ApiError,
  REF_CODE_RE,
  RateLimiter,
  asEnum,
  asInt,
  asSignature,
  errorResponse,
  jsonResponse,
  normalizeAddress,
  readJson,
} from './security'

export interface AppDeps {
  db: GameDb
  signer: PrivateKeyAccount | null
  hub: Address | null
  chain: ChainReader | null
  now?: () => number
  trustProxy?: boolean
}

type Route = (req: Request, url: URL, ip: string) => Promise<Response>

const BOOST_TTL_MS = 30_000
const BOOST_TIMEOUT_MS = 2500

export function createApp(deps: AppDeps) {
  const { db, signer, hub, chain } = deps
  const now = deps.now ?? Date.now
  const limiter = new RateLimiter()
  const boosts = new Map<string, { weight: number; at: number }>()

  const limit = (key: string, capacity: number, perSec: number) => {
    const wait = limiter.take(key, capacity, perSec, now())
    if (wait > 0) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.', wait)
  }

  /* ------------------------------------------------------------ helpers */

  async function refreshBoost(address: string): Promise<void> {
    if (!chain) return
    const cached = boosts.get(address)
    if (cached && now() - cached.at < BOOST_TTL_MS) return
    try {
      const weight = await Promise.race([
        chain.boostWeight(address as Address),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), BOOST_TIMEOUT_MS)),
      ])
      boosts.set(address, { weight, at: now() })
    } catch {
      boosts.set(address, { weight: cached?.weight ?? 0, at: now() - BOOST_TTL_MS + 5000 })
    }
  }

  const ctxFor = (address: string): EngineContext => ({
    stakeBoost: stakeBoostFromWeight(boosts.get(address)?.weight ?? 0),
  })

  function authed(req: Request): { address: string; token: string } {
    const header = req.headers.get('authorization') ?? ''
    const match = /^Bearer ([0-9a-f]{64})$/.exec(header)
    if (!match) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in with your wallet first.')
    const address = db.sessionAddress(match[1], now())
    if (!address) throw new ApiError(401, 'SESSION_EXPIRED', 'Your session expired. Sign in again.')
    return { address, token: match[1] }
  }

  function userOrThrow(address: string): UserRow {
    const user = db.getUser(address)
    if (!user) throw new ApiError(404, 'NO_PLAYER', 'Player not found.')
    return user
  }

  function payReferrer(referrer: string, minedValue: number, t: number): void {
    const row = db.getUser(referrer)
    if (!row) return
    const { state, credited } = creditReferral(row.state, minedValue, t)
    if (credited <= 0) return
    db.saveState(referrer, state, hashPower(state), t)
    db.addRefIncome(referrer, credited)
  }

  /** Runs a pure engine step and persists it atomically with referral payouts. */
  function mutate<R extends { state: PlayerState; minedValue: number }>(
    address: string,
    step: (state: PlayerState, t: number, ctx: EngineContext) => R,
    extra?: (result: R, t: number) => void,
  ): R {
    const t = now()
    const user = userOrThrow(address)
    let result: R
    try {
      result = step(user.state, t, ctxFor(address))
    } catch (err) {
      if (err instanceof GameError) throw new ApiError(400, err.code, err.message)
      throw err
    }
    db.transaction(() => {
      db.saveState(address, result.state, hashPower(result.state), t)
      if (user.referrer && result.minedValue > 0) payReferrer(user.referrer, result.minedValue, t)
      extra?.(result, t)
    })
    return result
  }

  function snapshot(address: string) {
    const t = now()
    const user = userOrThrow(address)
    const ctx = ctxFor(address)
    const state = settle(user.state, t, ctx).state
    const day = utcDay(t)
    const globalUsed = db.globalSwapMicro(day)
    const view = viewOf(state, ctx)
    return {
      address,
      serverTime: t,
      actionNonce: user.actionNonce,
      state,
      view,
      quests: QUESTS.map((q) => ({ ...q, progress: Math.min(q.target, questProgress(state, q.id)), claimed: state.daily.claimed.includes(q.id) })),
      swap: {
        factor: swapFactor(globalUsed),
        globalUsedMicro: globalUsed,
        globalCapMicro: SWAP_GLOBAL_DAILY_CAP_MICRO,
        userUsedMicro: state.daily.swapMicro,
        userCapMicro: userSwapCapMicro(view.level),
        earnedMicro: state.hgemEarnedMicro,
        perGem: Object.fromEntries(
          GEM_IDS.map((g) => [g, Math.round(SWAP_BASE_HGEM_PER_BRONZE * GEM_VALUE[g] * 1_000_000 * swapFactor(globalUsed)) / 1_000_000]),
        ),
      },
      referral: {
        code: user.refCode,
        invited: db.countReferrals(address),
        income: user.refIncome,
        sharePct: REFERRAL_SHARE * 100,
        dailyCap: REFERRAL_DAILY_CAP_BRONZE,
        earnedToday: state.daily.day === day ? state.daily.refEarned : 0,
      },
    }
  }

  /** Persists passive earnings, then returns the fresh snapshot. */
  async function sync(address: string) {
    await refreshBoost(address)
    mutate(address, (s, t, c) => settle(s, t, c))
    return snapshot(address)
  }

  /* -------------------------------------------------------------- routes */

  const routes: Record<string, Route> = {
    'GET /api/health': async () => jsonResponse({ ok: true, players: db.userCount() }),

    'GET /api/config': async () =>
      jsonResponse({
        ok: true,
        chainId: SEPOLIA_CHAIN_ID,
        hub,
        claimsEnabled: Boolean(hub && signer && chain),
        gems: GEMS,
      }),

    'POST /api/auth/nonce': async (req, _url, ip) => {
      limit(`auth:ip:${ip}`, 30, 0.5)
      const body = await readJson(req)
      const address = normalizeAddress(body.address)
      limit(`auth:addr:${address}`, 5, 0.05)
      const nonce = randomBytes(16).toString('hex')
      const t = now()
      db.putNonce(address, nonce, t, t + NONCE_TTL_MS)
      const issuedAt = new Date(t).toISOString()
      return jsonResponse({ ok: true, nonce, issuedAt, message: loginMessage(address, nonce, issuedAt) })
    },

    'POST /api/auth/verify': async (req, _url, ip) => {
      limit(`auth:ip:${ip}`, 30, 0.5)
      const body = await readJson(req)
      const address = normalizeAddress(body.address)
      const signature = asSignature(body.signature)
      limit(`auth:addr:${address}`, 8, 0.1)
      const t = now()
      const pending = db.takeNonce(address, t)
      if (!pending) throw new ApiError(401, 'NONCE_EXPIRED', 'Sign-in request expired. Try again.')
      const message = loginMessage(address, pending.nonce, new Date(pending.issuedAt).toISOString())
      const recovered = await recoverSigner(message, signature)
      if (recovered !== address) throw new ApiError(401, 'BAD_SIGNATURE', 'The signature does not match your wallet.')
      let user = db.getUser(address)
      if (!user) {
        let referrer: string | null = null
        if (body.ref !== undefined && body.ref !== null && body.ref !== '') {
          if (typeof body.ref !== 'string' || !REF_CODE_RE.test(body.ref.toUpperCase())) {
            throw new ApiError(400, 'BAD_REF', 'That invite code is not valid.')
          }
          const inviter = db.userByCode(body.ref.toUpperCase())
          if (inviter && inviter.address !== address) referrer = inviter.address
        }
        user = db.createUser(address, referrer, t)
      }
      const token = db.createSession(address, t)
      return jsonResponse({ ok: true, token, address, isNew: user.createdAt === t })
    },

    'POST /api/auth/logout': async (req) => {
      const { token } = authed(req)
      db.deleteSession(token)
      return jsonResponse({ ok: true })
    },

    'GET /api/me': async (req) => {
      const { address } = authed(req)
      limit(`me:${address}`, 20, 4)
      return jsonResponse({ ok: true, ...(await sync(address)) })
    },

    'POST /api/tap': async (req) => {
      const { address } = authed(req)
      limit(`tap:${address}`, 12, 4)
      const body = await readJson(req)
      const count = asInt(body.count, 'count', 1, 50)
      await refreshBoost(address)
      const r = mutate(address, (s, t, c) => tap(s, count, t, c))
      return jsonResponse({ ok: true, tapped: r.tapped, ...snapshot(address) })
    },

    'POST /api/hamsters/hire': async (req) => {
      const { address } = authed(req)
      limit(`act:${address}`, 10, 2)
      const body = await readJson(req)
      const tier = asInt(body.tier, 'tier', 1, 10)
      await refreshBoost(address)
      mutate(address, (s, t, c) => hire(s, tier, t, c))
      return jsonResponse({ ok: true, ...snapshot(address) })
    },

    'POST /api/hamsters/upgrade': async (req) => {
      const { address } = authed(req)
      limit(`act:${address}`, 10, 2)
      const body = await readJson(req)
      const tier = asInt(body.tier, 'tier', 1, 10)
      await refreshBoost(address)
      mutate(address, (s, t, c) => upgrade(s, tier, t, c))
      return jsonResponse({ ok: true, ...snapshot(address) })
    },

    'POST /api/refine': async (req) => {
      const { address } = authed(req)
      limit(`act:${address}`, 10, 2)
      const body = await readJson(req)
      const from = asEnum(body.from, 'from', GEM_IDS)
      const units = asInt(body.units, 'units', 1, 1000)
      await refreshBoost(address)
      mutate(address, (s, t, c) => refine(s, from, units, t, c))
      return jsonResponse({ ok: true, ...snapshot(address) })
    },

    'POST /api/checkin': async (req) => {
      const { address } = authed(req)
      limit(`act:${address}`, 10, 2)
      await refreshBoost(address)
      const r = mutate(address, (s, t, c) => checkIn(s, t, c))
      return jsonResponse({ ok: true, reward: r.reward, ...snapshot(address) })
    },

    'POST /api/quests/claim': async (req) => {
      const { address } = authed(req)
      limit(`act:${address}`, 10, 2)
      const body = await readJson(req)
      const id = asEnum(body.id, 'id', QUESTS.map((q) => q.id))
      await refreshBoost(address)
      mutate(address, (s, t, c) => claimQuest(s, id, t, c))
      return jsonResponse({ ok: true, ...snapshot(address) })
    },

    'GET /api/swap/quote': async (req, url) => {
      const { address } = authed(req)
      limit(`act:${address}`, 10, 2)
      const gem = asEnum(url.searchParams.get('gem'), 'gem', GEM_IDS)
      const amount = Number(url.searchParams.get('amount'))
      const user = userOrThrow(address)
      const t = now()
      const state = settle(user.state, t, ctxFor(address)).state
      try {
        return jsonResponse({ ok: true, quote: quoteSwap(state, gem, amount, db.globalSwapMicro(utcDay(t))) })
      } catch (err) {
        if (err instanceof GameError) throw new ApiError(400, err.code, err.message)
        throw err
      }
    },

    'POST /api/swap': async (req) => {
      const { address } = authed(req)
      limit(`sensitive:${address}`, 5, 0.2)
      const body = await readJson(req)
      const gem = asEnum(body.gem, 'gem', GEM_IDS)
      const amount = asInt(body.amount, 'amount', 1, 1_000_000)
      const nonce = await verifyAction(address, 'swap', `${amount} ${gem}`, body.nonce, body.signature)
      await refreshBoost(address)
      if (userOrThrow(address).actionNonce !== nonce) {
        throw new ApiError(409, 'STALE_NONCE', 'Your request was out of date. Please try again.')
      }
      const r = mutate(
        address,
        (s, t, c) => swap(s, gem, amount, db.globalSwapMicro(utcDay(t)), t, c),
        (res, t) => {
          db.bumpActionNonce(address)
          db.addGlobalSwap(utcDay(t), res.quote.hgemMicro)
        },
      )
      return jsonResponse({ ok: true, quote: r.quote, ...snapshot(address) })
    },

    'POST /api/voucher': async (req) => {
      const { address } = authed(req)
      limit(`sensitive:${address}`, 5, 0.2)
      if (!hub || !signer || !chain) {
        throw new ApiError(503, 'CLAIMS_OFFLINE', 'Onchain claims are not configured yet.')
      }
      const body = await readJson(req)
      const nonce = await verifyAction(address, 'claim', 'all', body.nonce, body.signature)
      let claimed: bigint
      try {
        claimed = await chain.claimedOf(address as Address)
      } catch {
        throw new ApiError(503, 'CHAIN_UNAVAILABLE', 'Could not read the chain right now. Try again shortly.')
      }
      const user = userOrThrow(address)
      if (user.actionNonce !== nonce) throw new ApiError(409, 'STALE_NONCE', 'Your request was out of date. Please try again.')
      const earnedWei = BigInt(Math.floor(user.state.hgemEarnedMicro)) * 10n ** 12n
      const cumulative = earnedWei
      if (cumulative <= claimed) throw new ApiError(409, 'NOTHING_TO_CLAIM', 'You have no swapped HGEM waiting to be claimed.')
      const deadline = BigInt(Math.floor(now() / 1000) + VOUCHER_TTL_SEC)
      const signature = await signVoucher({ signer, hub, account: address as Address, cumulative, deadline })
      db.bumpActionNonce(address)
      return jsonResponse({
        ok: true,
        account: address,
        cumulative: cumulative.toString(),
        deadline: deadline.toString(),
        signature,
        claimable: (cumulative - claimed).toString(),
      })
    },

    'GET /api/leaderboard': async (req, url, ip) => {
      limit(`lb:${ip}`, 30, 1)
      const by = asEnum(url.searchParams.get('by') ?? 'gems', 'by', ['gems', 'xp'] as const)
      let me: string | null = null
      try {
        me = authed(req).address
      } catch {
        me = null
      }
      const rows = db.leaderboard(by, 50).map((r, i) => ({
        rank: i + 1,
        address: `${r.address.slice(0, 6)}…${r.address.slice(-4)}`,
        xp: r.xp,
        totalMined: Math.floor(r.total_mined),
        hashPower: r.hash_power,
        isYou: r.address === me,
      }))
      return jsonResponse({ ok: true, by, rows, you: me ? { rank: db.rankOf(me, by) } : null, players: db.userCount() })
    },
  }

  function clientIp(req: Request, socketIp: string): string {
    if (deps.trustProxy) {
      const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      if (forwarded && forwarded.length <= 45) return forwarded
    }
    return socketIp
  }

  return {
    async handle(req: Request, socketIp: string): Promise<Response> {
      try {
        const url = new URL(req.url)
        const route = routes[`${req.method} ${url.pathname}`]
        if (!route) {
          const known = Object.keys(routes).some((k) => k.endsWith(` ${url.pathname}`))
          throw new ApiError(known ? 405 : 404, known ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', 'Not found.')
        }
        const ip = clientIp(req, socketIp)
        limit(`ip:${ip}`, 200, 40)
        return await route(req, url, ip)
      } catch (err) {
        return errorResponse(err)
      }
    },
  }
}

export function signerFromKey(key: `0x${string}` | undefined): PrivateKeyAccount | null {
  return key ? privateKeyToAccount(key) : null
}
