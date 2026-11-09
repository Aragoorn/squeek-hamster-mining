import { describe, expect, test } from 'bun:test'
import {
  checkIn,
  claimQuest,
  hashPower,
  hire,
  hireCost,
  levelFromXp,
  multiplier,
  newPlayer,
  quoteSwap,
  refine,
  settle,
  stakeBoostFromWeight,
  swap,
  swapFactor,
  tap,
  upgrade,
  upgradeCost,
  xpToReach,
} from '../src/game/engine'
import { GameError } from '../src/game/types'
import {
  IDLE_CAP_SECONDS,
  MAX_TAP_BATCH,
  SWAP_GLOBAL_DAILY_CAP_MICRO,
  SWAP_MIN_FACTOR,
  TAP_BUCKET_MAX,
} from '../src/game/config'
import type { PlayerState } from '../src/game/types'

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0)
const ctx = { stakeBoost: 0 }
const sec = (n: number) => T0 + n * 1000

function rich(): PlayerState {
  const s = newPlayer(T0)
  s.gems = { bronze: 100_000, silver: 100_000, gold: 100_000, royal: 100 }
  s.xp = xpToReach(12)
  return s
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    if (e instanceof GameError) return e.code
    throw e
  }
  return 'NO_ERROR'
}

describe('levels', () => {
  test('xp thresholds are monotonic and invertible', () => {
    let prev = -1
    for (let l = 1; l <= 60; l++) {
      const x = xpToReach(l)
      expect(x).toBeGreaterThan(prev)
      expect(levelFromXp(x)).toBe(l)
      prev = x
    }
    expect(levelFromXp(0)).toBe(1)
    expect(levelFromXp(xpToReach(5) - 1)).toBe(4)
  })
})

describe('idle mining', () => {
  test('one level-1 worker mines 60 bronze per hour', () => {
    const { state } = settle(newPlayer(T0), sec(3600), ctx)
    expect(state.gems.bronze).toBeCloseTo(60, 4)
    expect(state.totalMined).toBeCloseTo(60, 4)
  })

  test('idle accrual is capped per settlement window', () => {
    const { state } = settle(newPlayer(T0), sec(IDLE_CAP_SECONDS * 5), ctx)
    expect(state.gems.bronze).toBeCloseTo((60 * IDLE_CAP_SECONDS) / 3600, 4)
  })

  test('splitting a window does not create gems', () => {
    const a = settle(settle(newPlayer(T0), sec(1800), ctx).state, sec(3600), ctx).state
    const b = settle(newPlayer(T0), sec(3600), ctx).state
    expect(a.gems.bronze).toBeCloseTo(b.gems.bronze, 4)
  })

  test('time going backwards never mines or rewinds', () => {
    const s = settle(newPlayer(T0), sec(-500), ctx).state
    expect(s.gems.bronze).toBe(0)
    expect(s.lastSettle).toBe(T0)
  })

  test('input state is never mutated', () => {
    const s = newPlayer(T0)
    const snapshot = JSON.stringify(s)
    settle(s, sec(1000), ctx)
    expect(JSON.stringify(s)).toBe(snapshot)
  })

  test('multiplier scales idle output', () => {
    const s = newPlayer(T0)
    s.streak = 10
    const m = multiplier(s, { stakeBoost: 0.2 })
    expect(m.total).toBeCloseTo(1 + 0.1 + 0.2, 6)
    const out = settle(s, sec(3600), { stakeBoost: 0.2 }).state
    expect(out.gems.bronze).toBeCloseTo(60 * 1.3, 4)
  })

  test('hash power sums tiers and levels', () => {
    const s = rich()
    expect(hashPower(s)).toBe(10)
    s.hamsters[5] = { count: 2, level: 6 }
    expect(hashPower(s)).toBe(10 + Math.round(2 * 80 * 2))
  })
})

describe('energy and tapping', () => {
  test('tap spends energy and yields bronze with xp', () => {
    const r = tap(newPlayer(T0), 10, T0, ctx)
    expect(r.tapped).toBe(10)
    expect(r.state.gems.bronze).toBeCloseTo(10, 4)
    expect(r.state.energy).toBeCloseTo(490, 4)
    expect(r.state.xp).toBe(10)
    expect(r.state.daily.taps).toBe(10)
  })

  test('rejects invalid batches', () => {
    for (const n of [0, -1, 1.5, MAX_TAP_BATCH + 1, Number.NaN]) {
      expect(codeOf(() => tap(newPlayer(T0), n, T0, ctx))).toBe('BAD_INPUT')
    }
  })

  test('the tap bucket blocks bot-speed tapping', () => {
    let s = newPlayer(T0)
    let total = 0
    for (let i = 0; i < 5; i++) {
      try {
        const r = tap(s, MAX_TAP_BATCH, T0, ctx)
        s = r.state
        total += r.tapped
      } catch (e) {
        expect(e).toBeInstanceOf(GameError)
        break
      }
    }
    expect(total).toBeLessThanOrEqual(TAP_BUCKET_MAX)
  })

  test('bucket refills over time at the configured rate', () => {
    let s = tap(newPlayer(T0), MAX_TAP_BATCH, T0, ctx).state
    expect(codeOf(() => tap(s, 1, T0, ctx))).toBe('TOO_FAST')
    s = tap(s, 5, sec(1), ctx).state
    expect(s.daily.taps).toBeGreaterThan(TAP_BUCKET_MAX - 1)
  })

  test('cannot tap without energy', () => {
    const s = newPlayer(T0)
    s.energy = 0.5
    expect(codeOf(() => tap(s, 1, T0, ctx))).toBe('NO_ENERGY')
  })

  test('energy regenerates and is capped', () => {
    const s = newPlayer(T0)
    s.energy = 0
    expect(settle(s, sec(30), ctx).state.energy).toBeCloseTo(10, 3)
    expect(settle(s, sec(100_000), ctx).state.energy).toBe(500)
  })
})

describe('hamsters', () => {
  test('hire cost grows geometrically and spends the right gem', () => {
    const s = rich()
    expect(hireCost(s, 1).amount).toBe(150)
    const after = hire(s, 1, T0, ctx).state
    expect(after.hamsters[1].count).toBe(2)
    expect(after.gems.bronze).toBe(100_000 - 150)
    expect(hireCost(after, 1).amount).toBe(225)
  })

  test('higher tiers are gated by player level', () => {
    const s = newPlayer(T0)
    s.gems.silver = 10_000
    expect(codeOf(() => hire(s, 5, T0, ctx))).toBe('LOCKED')
    const unlocked = { ...s, xp: xpToReach(5) }
    expect(hire(unlocked, 5, T0, ctx).state.hamsters[5].count).toBe(1)
  })

  test('cannot hire what you cannot afford or unknown tiers', () => {
    const s = newPlayer(T0)
    expect(codeOf(() => hire(s, 1, T0, ctx))).toBe('INSUFFICIENT')
    expect(codeOf(() => hire(s, 3, T0, ctx))).toBe('BAD_INPUT')
  })

  test('upgrade raises mining output and records quest progress', () => {
    const s = rich()
    expect(upgradeCost(s, 1).amount).toBe(150)
    const up = upgrade(s, 1, T0, ctx).state
    expect(up.hamsters[1].level).toBe(2)
    expect(up.daily.upgrades).toBe(1)
    expect(settle(up, sec(3600), ctx).state.gems.bronze - up.gems.bronze).toBeGreaterThan(60)
  })

  test('cannot upgrade an empty slot or beyond max level', () => {
    const s = rich()
    expect(codeOf(() => upgrade(s, 5, T0, ctx))).toBe('LOCKED')
    s.hamsters[1].level = 20
    expect(codeOf(() => upgrade(s, 1, T0, ctx))).toBe('MAXED')
  })
})

describe('refining', () => {
  test('12 bronze make 1 silver, spending exactly the input', () => {
    const s = rich()
    const r = refine(s, 'bronze', 3, T0, ctx).state
    expect(r.gems.bronze).toBe(100_000 - 36)
    expect(r.gems.silver).toBe(100_003)
  })

  test('gold refines to royal at 25 to 1; royal cannot be refined', () => {
    const s = rich()
    expect(refine(s, 'gold', 2, T0, ctx).state.gems.royal).toBe(102)
    expect(codeOf(() => refine(s, 'royal', 1, T0, ctx))).toBe('BAD_INPUT')
  })

  test('rejects bad quantities and insufficient funds', () => {
    expect(codeOf(() => refine(newPlayer(T0), 'bronze', 1, T0, ctx))).toBe('INSUFFICIENT')
    expect(codeOf(() => refine(rich(), 'bronze', 0, T0, ctx))).toBe('BAD_INPUT')
    expect(codeOf(() => refine(rich(), 'bronze', 1.5, T0, ctx))).toBe('BAD_INPUT')
    expect(codeOf(() => refine(rich(), 'diamond', 1, T0, ctx))).toBe('BAD_INPUT')
  })

  test('refining never creates value out of thin air', () => {
    const s = rich()
    const r = refine(s, 'bronze', 100, T0, ctx).state
    const before = s.gems.bronze + s.gems.silver * 12
    const after = r.gems.bronze + r.gems.silver * 12
    expect(after).toBeLessThanOrEqual(before)
  })
})

describe('check-in and quests', () => {
  test('check-in builds streaks and refuses doubles', () => {
    const day = 86_400_000
    let s = checkIn(newPlayer(T0), T0, ctx).state
    expect(s.streak).toBe(1)
    expect(codeOf(() => checkIn(s, T0 + 1000, ctx))).toBe('ALREADY_DONE')
    s = checkIn(s, T0 + day, ctx).state
    expect(s.streak).toBe(2)
    s = checkIn(s, T0 + 4 * day, ctx).state
    expect(s.streak).toBe(1)
  })

  test('daily counters reset at UTC midnight', () => {
    const s = tap(newPlayer(T0), 10, T0, ctx).state
    expect(settle(s, T0 + 86_400_000, ctx).state.daily.taps).toBe(0)
  })

  test('quests need progress, pay once, and raise the multiplier', () => {
    let s = newPlayer(T0)
    expect(codeOf(() => claimQuest(s, 'refine_1', T0, ctx))).toBe('INCOMPLETE')
    s = rich()
    s = refine(s, 'bronze', 1, T0, ctx).state
    const before = s.gems.bronze
    s = claimQuest(s, 'refine_1', T0, ctx).state
    expect(s.gems.bronze).toBe(before + 200)
    expect(codeOf(() => claimQuest(s, 'refine_1', T0, ctx))).toBe('ALREADY_DONE')
    expect(multiplier(s, ctx).quests).toBeCloseTo(0.05, 6)
    expect(codeOf(() => claimQuest(s, 'nope', T0, ctx))).toBe('BAD_INPUT')
  })
})

describe('swap formulas', () => {
  test('rate factor falls with global usage and never below the floor', () => {
    expect(swapFactor(0)).toBe(1)
    expect(swapFactor(SWAP_GLOBAL_DAILY_CAP_MICRO / 2)).toBeCloseTo(0.7, 6)
    expect(swapFactor(SWAP_GLOBAL_DAILY_CAP_MICRO * 10)).toBe(SWAP_MIN_FACTOR)
    expect(swapFactor(-5)).toBe(1)
  })

  test('quote matches the published pricing', () => {
    const q = quoteSwap(rich(), 'gold', 10, 0)
    expect(q.rate).toBeCloseTo(0.72, 6)
    expect(q.hgemMicro).toBe(7_200_000)
  })

  test('swap burns gems, tracks the daily total and cumulative earnings', () => {
    const s = rich()
    const r = swap(s, 'gold', 10, 0, T0, ctx)
    expect(r.state.gems.gold).toBe(100_000 - 10)
    expect(r.state.hgemEarnedMicro).toBe(7_200_000)
    expect(r.state.daily.swapMicro).toBe(7_200_000)
    expect(r.state.daily.swaps).toBe(1)
  })

  test('per-user daily cap is enforced and accumulates', () => {
    let s = rich()
    s.xp = 0
    const cap = 250
    expect(cap).toBe(250)
    s = swap(s, 'royal', 10, 0, T0, ctx).state
    expect(s.daily.swapMicro).toBe(180_000_000)
    expect(codeOf(() => swap(s, 'royal', 10, 0, T0, ctx))).toBe('USER_CAP')
  })

  test('global cap is enforced and deeper usage lowers payout', () => {
    const s = rich()
    expect(codeOf(() => swap(s, 'gold', 10, SWAP_GLOBAL_DAILY_CAP_MICRO - 1, T0, ctx))).toBe('GLOBAL_CAP')
    const full = quoteSwap(s, 'gold', 10, 0).hgemMicro
    const half = quoteSwap(s, 'gold', 10, SWAP_GLOBAL_DAILY_CAP_MICRO / 2).hgemMicro
    expect(half).toBeLessThan(full)
  })

  test('rejects bad swap input and dust', () => {
    const s = rich()
    expect(codeOf(() => swap(s, 'gold', 0, 0, T0, ctx))).toBe('BAD_INPUT')
    expect(codeOf(() => swap(s, 'gold', 2.5, 0, T0, ctx))).toBe('BAD_INPUT')
    expect(codeOf(() => swap(s, 'diamond', 1, 0, T0, ctx))).toBe('BAD_INPUT')
    expect(codeOf(() => swap(newPlayer(T0), 'bronze', 1, 0, T0, ctx))).toBe('INSUFFICIENT')
  })

  test('daily swap total resets on a new UTC day', () => {
    let s = rich()
    s = swap(s, 'gold', 10, 0, T0, ctx).state
    const next = settle(s, T0 + 86_400_000, ctx).state
    expect(next.daily.swapMicro).toBe(0)
    expect(next.hgemEarnedMicro).toBe(7_200_000)
  })
})

describe('stake boost', () => {
  test('is zero without stake, monotonic, and capped', () => {
    expect(stakeBoostFromWeight(0)).toBe(0)
    expect(stakeBoostFromWeight(-10)).toBe(0)
    expect(stakeBoostFromWeight(Number.NaN)).toBe(0)
    expect(stakeBoostFromWeight(1000)).toBeGreaterThan(stakeBoostFromWeight(100))
    expect(stakeBoostFromWeight(1e12)).toBe(0.5)
  })
})
