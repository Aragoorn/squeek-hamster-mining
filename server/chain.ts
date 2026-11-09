/** Read-only access to the deployed GemHub. The server never sends transactions. */
import { createPublicClient, http, parseAbi, type Address } from 'viem'
import { sepolia } from 'viem/chains'

const HUB_ABI = parseAbi([
  'function claimed(address) view returns (uint256)',
  'function positions(address,uint8) view returns (uint128 amount, uint48 lockEnd, uint48 lastClaim)',
])

/** Mining boost per staking tier, in basis points. Mirrors `src/lib/hub.ts`. */
const TIER_BOOST_BPS = [10000n, 11000n, 12500n, 15000n] as const

export interface ChainReader {
  claimedOf(account: Address): Promise<bigint>
  /** Staked weight in whole HGEM units (principal times tier boost). */
  boostWeight(account: Address): Promise<number>
}

export function createChainReader(rpcUrl: string, hub: Address): ChainReader {
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl, { timeout: 4000, retryCount: 1, batch: true }) })
  return {
    claimedOf: (account) => client.readContract({ address: hub, abi: HUB_ABI, functionName: 'claimed', args: [account] }),
    boostWeight: async (account) => {
      const tiers = await Promise.all(
        [0, 1, 2, 3].map((tier) =>
          client.readContract({ address: hub, abi: HUB_ABI, functionName: 'positions', args: [account, tier] }),
        ),
      )
      let weightWei = 0n
      tiers.forEach(([amount], i) => {
        weightWei += (amount * TIER_BOOST_BPS[i]) / 10000n
      })
      return Number(weightWei / 10n ** 14n) / 10_000
    },
  }
}
