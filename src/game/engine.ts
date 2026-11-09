/**
 * Pure game engine. No I/O, no clocks: every function takes `now` (ms) explicitly,
 * never mutates its input, and throws `GameError` for invalid actions.
 */
import {
  ENERGY_BASE,
  ENERGY_PER_LEVEL,
  ENERGY_REGEN_PER_SEC,
  GEM_IDS,
  GEM_VALUE,
  IDLE_CAP_SECONDS,
  LEVEL_BOOST_EACH,
  MAX_LEVEL,
  MAX_TAP_BATCH,
  QUESTS,
  QUEST_BOOST_EACH,
  REFERRAL_DAILY_CAP_BRONZE,
  REFERRAL_SHARE,
  REFINE,
  STAKE_BOOST_MAX,
  STREAK_BOOST_EACH,
  STREAK_BOOST_MAX_DAYS,
  SWAP_BASE_HGEM_PER_BRONZE,
  SWAP_GLOBAL_DAILY_CAP_MICRO,
  SWAP_MAX_DISCOUNT,
  SWAP_MIN_FACTOR,
  SWAP_USER_DAILY_BASE_MICRO,
  SWAP_USER_DAILY_PER_LEVEL_MICRO,
  TAP_BUCKET_MAX,
  TAP_BUCKET_REFILL_PER_SEC,
  TIERS,
  TIER_IDS,
  type GemId,
  type TierId,
} from './config'
import {
  GameError,
  type DailyState,
  type EngineContext,
  type MultiplierBreakdown,
  type PlayerState,
  type SwapQuote,
} from './types'

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

function emptyDaily(day: string): DailyState {
  return { day, taps: 0, refines: 0, upgrades: 0, swaps: 0, checkedIn: false, claimed: [], swapMicro: 0, refEarned: 0 }
}

export function newPlayer(now: number): PlayerState {
  return {
    v: 1,
    gems: { bronze: 0, silver: 0, gold: 0, royal: 0 },
    totalMined: 0,
    xp: 0,
    energy: energyMax(1),
    tapTokens: TAP_BUCKET_MAX,
    hamsters: { 1: { count: 1, level: 1 }, 5: { count: 0, level: 1 }, 10: { count: 0, level: 1 } },
    lastSettle: now,
    streak: 0,
    lastCheckIn: '',
    daily: emptyDaily(utcDay(now)),
    hgemEarnedMicro: 0,
  }
}

/* ------------------------------------------------------------------ levels */

export function xpToReach(level: number): number {
  return level <= 1 ? 0 : Math.round(50 * Math.pow(level - 1, 2.2))
}

export function levelFromXp(xp: number): number {
  let level = 1
  while (level < MAX_LEVEL && xp >= xpToReach(level + 1)) level += 1
  return level
}

export function energyMax(level: number): number {
  return ENERGY_BASE + ENERGY_PER_LEVEL * (level - 1)
}

/* ------------------------------------------------------------ derived stats */

export function levelMult(level: number): number {
  return 1 + 0.2 * (level - 1)
}

export function tierRatePerHour(state: PlayerState, tier: TierId): number {
  const slot = state.hamsters[tier]
  if (slot.count === 0) return 0
  return slot.count * TIERS[tier].baseRate * levelMult(slot.level)
}

export function hashPower(state: PlayerState): number {
  let total = 0
  for (const id of TIER_IDS) {
    const slot = state.hamsters[id]
    total += slot.count * TIERS[id].baseHash * levelMult(slot.level)
  }
  return Math.round(total)
}

export function stakeBoostFromWeight(weightHgem: number): number {
  if (!Number.isFinite(weightHgem) || weightHgem <= 0) return 0
  return Math.min(STAKE_BOOST_MAX, 0.05 * Math.log2(1 + weightHgem / 100))
}

export function multiplier(state: PlayerState, ctx: EngineContext): MultiplierBreakdown {
  const level = levelFromXp(state.xp)
  const lvl = LEVEL_BOOST_EACH * (level - 1)
  const streak = STREAK_BOOST_EACH * Math.min(state.streak, STREAK_BOOST_MAX_DAYS)
  const quests = QUEST_BOOST_EACH * state.daily.claimed.length
  const stake = Math.min(STAKE_BOOST_MAX, Math.max(0, ctx.stakeBoost))
  const total = 1 + lvl + streak + quests + stake
  return { base: 1, level: lvl, streak, quests, stake, total: round6(total) }
}

export function tapYield(state: PlayerState, ctx: EngineContext): number {
  const level = levelFromXp(state.xp)
  return round6((1 + 0.1 * (level - 1)) * multiplier(state, ctx).total)
}

/* ---------------------------------------------------------------- settling */

export interface Settlement {
  state: PlayerState
  /** Mined value in bronze equivalents during this settlement (for referral share). */
  minedValue: number
}

function rollDay(state: PlayerState, now: number): void {
  const day = utcDay(now)
  if (state.daily.day !== day) state.daily = emptyDaily(day)
}

function addGem(state: PlayerState, gem: GemId, amount: number): number {
  state.gems[gem] = round6(state.gems[gem] + amount)
  return amount * GEM_VALUE[gem]
}

function addXp(state: PlayerState, amount: number): void {
  state.xp += Math.max(0, Math.floor(amount))
}

/** Accrues idle mining, regenerates energy and refills the tap bucket. */
export function settle(input: PlayerState, now: number, ctx: EngineContext): Settlement {
  const state = structuredClone(input)
  rollDay(state, now)
  const elapsed = Math.max(0, (now - state.lastSettle) / 1000)
  let minedValue = 0
  if (elapsed > 0) {
    const mult = multiplier(state, ctx).total
    const idleSeconds = Math.min(elapsed, IDLE_CAP_SECONDS)
    for (const id of TIER_IDS) {
      const gained = (tierRatePerHour(state, id) / 3600) * idleSeconds * mult
      if (gained > 0) {
        const gem = TIERS[id].gem
        const amount = round6(gained)
        minedValue += addGem(state, gem, amount)
        state.totalMined = round6(state.totalMined + amount * GEM_VALUE[gem])
      }
    }
    const level = levelFromXp(state.xp)
    state.energy = Math.min(energyMax(level), state.energy + elapsed * ENERGY_REGEN_PER_SEC)
    state.tapTokens = Math.min(TAP_BUCKET_MAX, state.tapTokens + elapsed * TAP_BUCKET_REFILL_PER_SEC)
  }
  state.lastSettle = Math.max(state.lastSettle, now)
  return { state, minedValue }
}

/* --------------------------------------------------------------- referrals */

/** Credits a referrer with a share of a referee's mined value, bounded by a daily cap. */
export function creditReferral(
  input: PlayerState,
  refereeMinedValue: number,
  now: number,
): { state: PlayerState; credited: number } {
  const state = structuredClone(input)
  rollDay(state, now)
  const wanted = Math.max(0, refereeMinedValue) * REFERRAL_SHARE
  const room = Math.max(0, REFERRAL_DAILY_CAP_BRONZE - state.daily.refEarned)
  const credited = round6(Math.min(wanted, room))
  if (credited > 0) {
    state.gems.bronze = round6(state.gems.bronze + credited)
    state.daily.refEarned = round6(state.daily.refEarned + credited)
  }
  return { state, credited }
}

/* -------------------------------------------------------------------- tap */

export function tap(
  input: PlayerState,
  count: number,
  now: number,
  ctx: EngineContext,
): Settlement & { tapped: number } {
  if (!Number.isInteger(count) || count < 1 || count > MAX_TAP_BATCH) {
    throw new GameError('BAD_INPUT', `Tap count must be a whole number from 1 to ${MAX_TAP_BATCH}.`)
  }
  const settled = settle(input, now, ctx)
  const state = settled.state
  if (state.energy < 1) throw new GameError('NO_ENERGY', 'Out of energy. Wait for it to recharge.')
  const allowed = Math.min(count, Math.floor(state.tapTokens), Math.floor(state.energy))
  if (allowed < 1) throw new GameError('TOO_FAST', 'Slow down, you are tapping faster than a hamster can dig.')
  const perTap = tapYield(state, ctx)
  const gained = round6(perTap * allowed)
  const value = addGem(state, 'bronze', gained)
  state.totalMined = round6(state.totalMined + value)
  state.energy -= allowed
  state.tapTokens -= allowed
  state.daily.taps += allowed
  addXp(state, allowed)
  return { state, minedValue: settled.minedValue + value, tapped: allowed }
}

/* ----------------------------------------------------- hire and upgrades */

export function costAt(curve: { base: number; growth: number }, step: number): number {
  return Math.ceil(curve.base * Math.pow(curve.growth, step))
}

export function hireCost(state: PlayerState, tier: TierId): { gem: GemId; amount: number } {
  const cfg = TIERS[tier]
  return { gem: cfg.hire.gem, amount: costAt(cfg.hire, state.hamsters[tier].count) }
}

export function upgradeCost(state: PlayerState, tier: TierId): { gem: GemId; amount: number } {
  const cfg = TIERS[tier]
  return { gem: cfg.upgrade.gem, amount: costAt(cfg.upgrade, state.hamsters[tier].level - 1) }
}

function assertTier(tier: number): asserts tier is TierId {
  if (!(TIER_IDS as readonly number[]).includes(tier)) throw new GameError('BAD_INPUT', 'Unknown hamster tier.')
}

function spend(state: PlayerState, gem: GemId, amount: number): void {
  if (state.gems[gem] + 1e-9 < amount) {
    throw new GameError('INSUFFICIENT', `You need ${amount} ${gem} gems.`)
  }
  state.gems[gem] = round6(Math.max(0, state.gems[gem] - amount))
}

export function hire(input: PlayerState, tier: number, now: number, ctx: EngineContext): Settlement {
  assertTier(tier)
  const settled = settle(input, now, ctx)
  const state = settled.state
  const cfg = TIERS[tier]
  if (levelFromXp(state.xp) < cfg.unlockLevel) {
    throw new GameError('LOCKED', `Reach level ${cfg.unlockLevel} to deploy ${cfg.name}s.`)
  }
  if (state.hamsters[tier].count >= cfg.maxCount) throw new GameError('MAXED', `You already run ${cfg.maxCount} ${cfg.name}s.`)
  const cost = hireCost(state, tier)
  spend(state, cost.gem, cost.amount)
  state.hamsters[tier].count += 1
  addXp(state, 15 * (TIER_IDS.indexOf(tier) + 1))
  return { state, minedValue: settled.minedValue }
}

export function upgrade(input: PlayerState, tier: number, now: number, ctx: EngineContext): Settlement {
  assertTier(tier)
  const settled = settle(input, now, ctx)
  const state = settled.state
  const cfg = TIERS[tier]
  const slot = state.hamsters[tier]
  if (slot.count === 0) throw new GameError('LOCKED', `Deploy a ${cfg.name} first.`)
  if (slot.level >= cfg.maxLevel) throw new GameError('MAXED', `${cfg.name}s are at max level.`)
  const cost = upgradeCost(state, tier)
  spend(state, cost.gem, cost.amount)
  slot.level += 1
  state.daily.upgrades += 1
  addXp(state, 20)
  return { state, minedValue: settled.minedValue }
}

/* ---------------------------------------------------------------- refining */

export function refine(
  input: PlayerState,
  from: string,
  units: number,
  now: number,
  ctx: EngineContext,
): Settlement {
  if (!Number.isInteger(units) || units < 1 || units > 1000) {
    throw new GameError('BAD_INPUT', 'Refine between 1 and 1000 gems at a time.')
  }
  if (!(from in REFINE)) throw new GameError('BAD_INPUT', 'That gem cannot be refined further.')
  const recipe = REFINE[from as Exclude<GemId, 'royal'>]
  const settled = settle(input, now, ctx)
  const state = settled.state
  spend(state, from as GemId, recipe.input * units)
  state.gems[recipe.to] = round6(state.gems[recipe.to] + units)
  state.daily.refines += 1
  addXp(state, 10 * units)
  return { state, minedValue: settled.minedValue }
}

/* ----------------------------------------------------- check-in and quests */

export function checkIn(input: PlayerState, now: number, ctx: EngineContext): Settlement & { reward: number } {
  const settled = settle(input, now, ctx)
  const state = settled.state
  const today = utcDay(now)
  if (state.lastCheckIn === today) throw new GameError('ALREADY_DONE', 'You already checked in today.')
  const yesterday = utcDay(now - 86_400_000)
  state.streak = state.lastCheckIn === yesterday ? state.streak + 1 : 1
  state.lastCheckIn = today
  state.daily.checkedIn = true
  const reward = 100 + 50 * Math.min(state.streak, STREAK_BOOST_MAX_DAYS)
  addGem(state, 'bronze', reward)
  addXp(state, 25)
  return { state, minedValue: 0, reward }
}

export function questProgress(state: PlayerState, questId: string): number {
  const quest = QUESTS.find((q) => q.id === questId)
  return quest ? state.daily[quest.metric] : 0
}

export function claimQuest(input: PlayerState, questId: string, now: number, ctx: EngineContext): Settlement {
  const quest = QUESTS.find((q) => q.id === questId)
  if (!quest) throw new GameError('BAD_INPUT', 'Unknown quest.')
  const settled = settle(input, now, ctx)
  const state = settled.state
  if (state.daily.claimed.includes(quest.id)) throw new GameError('ALREADY_DONE', 'Quest already claimed.')
  if (state.daily[quest.metric] < quest.target) throw new GameError('INCOMPLETE', 'Finish the quest first.')
  state.daily.claimed.push(quest.id)
  addGem(state, 'bronze', quest.rewardBronze)
  addXp(state, quest.rewardXp)
  return { state, minedValue: 0 }
}

/* -------------------------------------------------------------------- swap */

export function userSwapCapMicro(level: number): number {
  return SWAP_USER_DAILY_BASE_MICRO + SWAP_USER_DAILY_PER_LEVEL_MICRO * (level - 1)
}

/** Rate factor falls from 1 toward SWAP_MIN_FACTOR as the global daily cap fills. */
export function swapFactor(globalUsedMicro: number): number {
  const fill = Math.min(1, Math.max(0, globalUsedMicro / SWAP_GLOBAL_DAILY_CAP_MICRO))
  return round6(Math.max(SWAP_MIN_FACTOR, 1 - SWAP_MAX_DISCOUNT * fill))
}

export function quoteSwap(
  state: PlayerState,
  gem: string,
  amount: number,
  globalUsedMicro: number,
): SwapQuote {
  if (!(GEM_IDS as readonly string[]).includes(gem)) throw new GameError('BAD_INPUT', 'Unknown gem.')
  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
    throw new GameError('BAD_INPUT', 'Swap a whole number of gems.')
  }
  const id = gem as GemId
  const factor = swapFactor(globalUsedMicro)
  const perUnitMicro = Math.round(SWAP_BASE_HGEM_PER_BRONZE * GEM_VALUE[id] * 1_000_000 * factor)
  const rate = perUnitMicro / 1_000_000
  const hgemMicro = perUnitMicro * amount
  const level = levelFromXp(state.xp)
  const used = state.daily.swapMicro
  return {
    gem: id,
    amount,
    rate: round6(rate),
    factor,
    hgemMicro,
    userRemainingMicro: Math.max(0, userSwapCapMicro(level) - used),
    globalRemainingMicro: Math.max(0, SWAP_GLOBAL_DAILY_CAP_MICRO - globalUsedMicro),
  }
}

export function swap(
  input: PlayerState,
  gem: string,
  amount: number,
  globalUsedMicro: number,
  now: number,
  ctx: EngineContext,
): Settlement & { quote: SwapQuote } {
  const settled = settle(input, now, ctx)
  const state = settled.state
  const quote = quoteSwap(state, gem, amount, globalUsedMicro)
  if (quote.hgemMicro < 1) throw new GameError('TOO_SMALL', 'That amount is worth less than the smallest HGEM unit.')
  if (quote.hgemMicro > quote.globalRemainingMicro) {
    throw new GameError('GLOBAL_CAP', 'The global daily swap cap is nearly full. Try again after 00:00 UTC.')
  }
  if (quote.hgemMicro > quote.userRemainingMicro) {
    throw new GameError('USER_CAP', 'That swap exceeds your daily limit. Try a smaller amount.')
  }
  spend(state, quote.gem, amount)
  state.daily.swapMicro += quote.hgemMicro
  state.daily.swaps += 1
  state.hgemEarnedMicro += quote.hgemMicro
  addXp(state, 10)
  return { state, minedValue: settled.minedValue, quote }
}

/* ------------------------------------------------------------------- views */

export interface PlayerView {
  level: number
  xp: number
  xpFloor: number
  xpNext: number
  energy: number
  energyMax: number
  hashPower: number
  multiplier: MultiplierBreakdown
  tapYield: number
  ratesPerHour: Record<TierId, number>
}

export function viewOf(state: PlayerState, ctx: EngineContext): PlayerView {
  const level = levelFromXp(state.xp)
  const ratesPerHour = { 1: 0, 5: 0, 10: 0 } as Record<TierId, number>
  const mult = multiplier(state, ctx)
  for (const id of TIER_IDS) ratesPerHour[id] = round6(tierRatePerHour(state, id) * mult.total)
  return {
    level,
    xp: state.xp,
    xpFloor: xpToReach(level),
    xpNext: level >= MAX_LEVEL ? xpToReach(level) : xpToReach(level + 1),
    energy: Math.floor(state.energy),
    energyMax: energyMax(level),
    hashPower: hashPower(state),
    multiplier: mult,
    tapYield: tapYield(state, ctx),
    ratesPerHour,
  }
}
