import type { GemId } from '@/game/config'
import type { PlayerView } from '@/game/engine'
import type { PlayerState } from '@/game/types'

export interface QuestStatus {
  id: string
  title: string
  metric: string
  target: number
  rewardBronze: number
  rewardXp: number
  progress: number
  claimed: boolean
}

export interface SwapInfo {
  factor: number
  globalUsedMicro: number
  globalCapMicro: number
  userUsedMicro: number
  userCapMicro: number
  earnedMicro: number
  perGem: Record<GemId, number>
}

export interface ReferralInfo {
  code: string
  invited: number
  income: number
  sharePct: number
  dailyCap: number
  earnedToday: number
}

export interface Snapshot {
  address: string
  serverTime: number
  actionNonce: number
  state: PlayerState
  view: PlayerView
  quests: QuestStatus[]
  swap: SwapInfo
  referral: ReferralInfo
}

export interface LeaderRow {
  rank: number
  address: string
  xp: number
  totalMined: number
  hashPower: number
  isYou: boolean
}

export interface LeaderboardResponse {
  by: 'gems' | 'xp'
  rows: LeaderRow[]
  you: { rank: number } | null
  players: number
}

export interface VoucherResponse {
  account: string
  cumulative: string
  deadline: string
  signature: `0x${string}`
  claimable: string
}
