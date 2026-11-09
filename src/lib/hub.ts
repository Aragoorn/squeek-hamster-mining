import { parseAbi, type Address } from 'viem'
import { sepolia } from 'wagmi/chains'

const raw = import.meta.env.VITE_GEM_HUB_ADDRESS as string | undefined

/** Deployed GemHub (HGEM token, claims, staking) on Sepolia. Undefined until configured. */
export const HUB_ADDRESS: Address | undefined = raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as Address) : undefined
export const HUB_CHAIN_ID = sepolia.id

export const HUB_ABI = parseAbi([
  'function claim(uint256 cumulative, uint256 deadline, bytes signature)',
  'function claimed(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function totalStaked() view returns (uint256)',
  'function rewardsMinted() view returns (uint256)',
  'function paused() view returns (bool)',
  'function positions(address, uint8) view returns (uint128 amount, uint48 lockEnd, uint48 lastClaim)',
  'function stake(uint256 amount, uint8 tier)',
  'function claimReward(uint8 tier)',
  'function unstake(uint8 tier)',
  'function unstakeEarly(uint8 tier)',
])

export interface StakeTier {
  id: 0 | 1 | 2 | 3
  name: string
  lockDays: number
  aprBps: number
  boostBps: number
}

/** Mirrors the constants compiled into the contract. */
export const STAKE_TIERS: readonly StakeTier[] = [
  { id: 0, name: 'Flexible', lockDays: 0, aprBps: 300, boostBps: 10000 },
  { id: 1, name: '7 days', lockDays: 7, aprBps: 800, boostBps: 11000 },
  { id: 2, name: '30 days', lockDays: 30, aprBps: 1500, boostBps: 12500 },
  { id: 3, name: '90 days', lockDays: 90, aprBps: 2500, boostBps: 15000 },
]

export const EARLY_EXIT_BURN_PCT = 20

export interface Position {
  amount: bigint
  lockEnd: number
  lastClaim: number
}

/** Reward payable right now (before the contract's supply and budget clipping). */
export function pendingReward(p: Position, tier: StakeTier, nowSec: number): bigint {
  if (p.amount === 0n) return 0n
  let end = nowSec
  if (tier.id !== 0 && end > p.lockEnd) end = p.lockEnd
  const elapsed = BigInt(Math.max(0, end - p.lastClaim))
  return (p.amount * BigInt(tier.aprBps) * elapsed) / (365n * 86400n * 10000n)
}
