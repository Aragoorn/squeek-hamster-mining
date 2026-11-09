/**
 * Static game economy configuration. Pure data, shared by the browser and the server.
 * The server is authoritative; the browser only uses these values for previews.
 */

export const GEM_IDS = ['bronze', 'silver', 'gold', 'royal'] as const
export type GemId = (typeof GEM_IDS)[number]

export const GEMS: Record<GemId, { name: string; short: string; blurb: string }> = {
  bronze: { name: 'Bronze Gem', short: 'BRZ', blurb: 'Mined by Workers and taps' },
  silver: { name: 'Silver Gem', short: 'SLV', blurb: 'Mined by Managers' },
  gold: { name: 'Gold Gem', short: 'GLD', blurb: 'Mined by Directors' },
  royal: { name: 'Royal Gem', short: 'RYL', blurb: 'Governance and swap gem, refined only' },
}

export const TIER_IDS = [1, 5, 10] as const
export type TierId = (typeof TIER_IDS)[number]

export interface CostCurve {
  gem: GemId
  base: number
  growth: number
}

export interface TierConfig {
  id: TierId
  name: string
  gem: GemId
  /** Gems per hour for one level-1 hamster. */
  baseRate: number
  /** Hash power for one level-1 hamster. */
  baseHash: number
  unlockLevel: number
  maxCount: number
  maxLevel: number
  hire: CostCurve
  upgrade: CostCurve
}

export const TIERS: Record<TierId, TierConfig> = {
  1: {
    id: 1,
    name: 'Worker',
    gem: 'bronze',
    baseRate: 60,
    baseHash: 10,
    unlockLevel: 1,
    maxCount: 10,
    maxLevel: 20,
    hire: { gem: 'bronze', base: 100, growth: 1.5 },
    upgrade: { gem: 'bronze', base: 150, growth: 1.5 },
  },
  5: {
    id: 5,
    name: 'Manager',
    gem: 'silver',
    baseRate: 12,
    baseHash: 80,
    unlockLevel: 5,
    maxCount: 10,
    maxLevel: 20,
    hire: { gem: 'silver', base: 150, growth: 1.6 },
    upgrade: { gem: 'silver', base: 60, growth: 1.5 },
  },
  10: {
    id: 10,
    name: 'Director',
    gem: 'gold',
    baseRate: 3,
    baseHash: 600,
    unlockLevel: 10,
    maxCount: 10,
    maxLevel: 20,
    hire: { gem: 'gold', base: 50, growth: 1.6 },
    upgrade: { gem: 'gold', base: 25, growth: 1.5 },
  },
}

/** Refining recipes: `input` lower gems become one higher gem. Deterministic, no randomness. */
export const REFINE: Record<Exclude<GemId, 'royal'>, { to: GemId; input: number }> = {
  bronze: { to: 'silver', input: 12 },
  silver: { to: 'gold', input: 12 },
  gold: { to: 'royal', input: 25 },
}

/** Value of one gem in bronze equivalents. Used for leaderboard and swap pricing. */
export const GEM_VALUE: Record<GemId, number> = {
  bronze: 1,
  silver: 12,
  gold: 144,
  royal: 3600,
}

export const ENERGY_BASE = 500
export const ENERGY_PER_LEVEL = 25
/** Energy regenerated per second. */
export const ENERGY_REGEN_PER_SEC = 1 / 3
export const IDLE_CAP_SECONDS = 8 * 3600
export const TAP_BUCKET_MAX = 30
export const TAP_BUCKET_REFILL_PER_SEC = 10
export const MAX_TAP_BATCH = 50
export const MAX_LEVEL = 60
export const REFERRAL_SHARE = 0.1
export const REFERRAL_DAILY_CAP_BRONZE = 5000

export const SWAP_BASE_HGEM_PER_BRONZE = 0.005
export const SWAP_GLOBAL_DAILY_CAP_MICRO = 100_000 * 1_000_000
export const SWAP_USER_DAILY_BASE_MICRO = 250 * 1_000_000
export const SWAP_USER_DAILY_PER_LEVEL_MICRO = 25 * 1_000_000
export const SWAP_MIN_FACTOR = 0.4
export const SWAP_MAX_DISCOUNT = 0.6

export interface QuestConfig {
  id: string
  title: string
  metric: 'taps' | 'refines' | 'upgrades' | 'swaps'
  target: number
  rewardBronze: number
  rewardXp: number
}

export const QUESTS: QuestConfig[] = [
  { id: 'tap_100', title: 'Tap the vein 100 times', metric: 'taps', target: 100, rewardBronze: 150, rewardXp: 40 },
  { id: 'refine_1', title: 'Refine gems once', metric: 'refines', target: 1, rewardBronze: 200, rewardXp: 50 },
  { id: 'upgrade_1', title: 'Upgrade a hamster', metric: 'upgrades', target: 1, rewardBronze: 300, rewardXp: 60 },
  { id: 'swap_1', title: 'Swap gems for HGEM', metric: 'swaps', target: 1, rewardBronze: 250, rewardXp: 50 },
]

export const QUEST_BOOST_EACH = 0.05
export const STREAK_BOOST_EACH = 0.01
export const STREAK_BOOST_MAX_DAYS = 30
export const LEVEL_BOOST_EACH = 0.02
export const STAKE_BOOST_MAX = 0.5
