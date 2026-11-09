import type { GemId, TierId } from './config'

export interface HamsterSlot {
  count: number
  level: number
}

export interface DailyState {
  /** UTC day, YYYY-MM-DD. */
  day: string
  taps: number
  refines: number
  upgrades: number
  swaps: number
  checkedIn: boolean
  claimed: string[]
  /** HGEM (micro units) this player swapped today. */
  swapMicro: number
  /** Referral income (bronze) earned today. */
  refEarned: number
}

export interface PlayerState {
  v: 1
  gems: Record<GemId, number>
  /** Lifetime mined value in bronze equivalents (leaderboard score). */
  totalMined: number
  xp: number
  energy: number
  tapTokens: number
  hamsters: Record<TierId, HamsterSlot>
  /** ms epoch of the last settlement. */
  lastSettle: number
  streak: number
  lastCheckIn: string
  daily: DailyState
  /** Cumulative HGEM (micro units, 1e-6) earned through swaps. Signed into claim vouchers. */
  hgemEarnedMicro: number
}

export interface EngineContext {
  /** Mining boost from staked HGEM, 0 to STAKE_BOOST_MAX. */
  stakeBoost: number
}

export interface MultiplierBreakdown {
  base: number
  level: number
  streak: number
  quests: number
  stake: number
  total: number
}

export class GameError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GameError'
    this.code = code
  }
}

export interface SwapQuote {
  gem: GemId
  amount: number
  /** HGEM per single gem after the dynamic factor. */
  rate: number
  factor: number
  hgemMicro: number
  userRemainingMicro: number
  globalRemainingMicro: number
}
