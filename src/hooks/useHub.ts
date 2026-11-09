import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useAccount, usePublicClient, useReadContracts, useSwitchChain } from 'wagmi'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { friendlyError } from '@/lib/api'
import { HUB_ABI, HUB_ADDRESS, HUB_CHAIN_ID, type Position } from '@/lib/hub'

export interface HubReads {
  configured: boolean
  loading: boolean
  balance: bigint
  claimed: bigint
  paused: boolean
  totalStaked: bigint
  positions: Position[]
  refetch: () => Promise<unknown>
}

const EMPTY: Position = { amount: 0n, lockEnd: 0, lastClaim: 0 }

export function useHubReads(account: `0x${string}` | undefined): HubReads {
  const enabled = Boolean(HUB_ADDRESS && account)
  const hub = { address: HUB_ADDRESS, abi: HUB_ABI, chainId: HUB_CHAIN_ID } as const
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { ...hub, functionName: 'balanceOf', args: [account ?? '0x0000000000000000000000000000000000000000'] },
      { ...hub, functionName: 'claimed', args: [account ?? '0x0000000000000000000000000000000000000000'] },
      { ...hub, functionName: 'paused' },
      { ...hub, functionName: 'totalStaked' },
      ...([0, 1, 2, 3] as const).map((tier) => ({
        ...hub,
        functionName: 'positions' as const,
        args: [account ?? '0x0000000000000000000000000000000000000000', tier] as const,
      })),
    ],
    query: { enabled, refetchInterval: 15_000 },
  })

  const val = <T,>(i: number, fallback: T): T => {
    const item = data?.[i]
    return item && item.status === 'success' ? (item.result as T) : fallback
  }

  const positions: Position[] = [4, 5, 6, 7].map((i) => {
    const r = val<readonly [bigint, number, number] | null>(i, null)
    return r ? { amount: r[0], lockEnd: Number(r[1]), lastClaim: Number(r[2]) } : EMPTY
  })

  return {
    configured: Boolean(HUB_ADDRESS),
    loading: enabled && isLoading,
    balance: val<bigint>(0, 0n),
    claimed: val<bigint>(1, 0n),
    paused: val<boolean>(2, false),
    totalStaked: val<bigint>(3, 0n),
    positions,
    refetch,
  }
}

/** Switches to Sepolia if needed, sends one transaction, waits for the receipt and toasts honest status. */
export function useHubTx() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const client = usePublicClient({ chainId: HUB_CHAIN_ID })
  const [busy, setBusy] = useState(false)

  const send = useCallback(
    async (label: string, run: () => Promise<`0x${string}`>): Promise<boolean> => {
      setBusy(true)
      let pendingToast: string | number | undefined
      try {
        if (chainId !== HUB_CHAIN_ID) await switchChainAsync({ chainId: HUB_CHAIN_ID })
        const hash = await run()
        pendingToast = toast.loading(`${label}: waiting for confirmation…`)
        if (!client) throw new Error('network')
        const receipt = await client.waitForTransactionReceipt({ hash })
        toast.dismiss(pendingToast)
        if (receipt.status !== 'success') throw new Error('reverted')
        toast.success(`${label} confirmed`, {
          action: { label: 'View', onClick: () => window.open(buildTxExplorerUrl(HUB_CHAIN_ID, hash), '_blank', 'noopener,noreferrer') },
        })
        return true
      } catch (err) {
        if (pendingToast !== undefined) toast.dismiss(pendingToast)
        toast.error(friendlyError(err))
        return false
      } finally {
        setBusy(false)
      }
    },
    [chainId, switchChainAsync, client],
  )

  return { send, busy }
}
