import { useState } from 'react'
import { ArrowDownToLine, ArrowLeftRight, ExternalLink } from 'lucide-react'
import { useWriteContract } from 'wagmi'
import { toast } from 'sonner'
import { GEMS, GEM_IDS, type GemId } from '@/game/config'
import { useGame } from '@/hooks/useGame'
import { useHubReads, useHubTx } from '@/hooks/useHub'
import { ApiError, apiRequest, friendlyError } from '@/lib/api'
import { formatHgem, formatInt, microToHgem } from '@/lib/format'
import { HUB_ABI, HUB_ADDRESS, HUB_CHAIN_ID } from '@/lib/hub'
import type { VoucherResponse } from '@/lib/types'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { Bar, Button, Card, GEM_BG, Notice, SectionTitle } from './ui'

function SwapCard() {
  const { live, snapshot, act, signAction } = useGame()
  const [gem, setGem] = useState<GemId>('gold')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  if (!live || !snapshot) return null

  const swap = snapshot.swap
  const have = Math.floor(live.gems[gem])
  const parsed = Number(amount)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= have
  const perUnitMicro = Math.round(swap.perGem[gem] * 1_000_000)
  const outMicro = valid ? perUnitMicro * parsed : 0
  const userLeft = Math.max(0, swap.userCapMicro - swap.userUsedMicro)
  const overCap = outMicro > userLeft
  const globalFill = swap.globalCapMicro > 0 ? swap.globalUsedMicro / swap.globalCapMicro : 0

  const submit = async () => {
    setBusy(true)
    try {
      const sig = await signAction('swap', `${parsed} ${gem}`)
      const ok = await act('/swap', { gem, amount: parsed, ...sig }, 'Swapped. Claim your HGEM below.')
      if (ok) setAmount('')
    } catch (err) {
      toast.error(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4">
      <SectionTitle title="Swap gems for HGEM" hint="Rates fall as the whole community swaps more today. Limits reset at 00:00 UTC." />
      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Gem to swap">
        {GEM_IDS.map((g) => (
          <button
            key={g}
            role="radio"
            aria-checked={gem === g}
            onClick={() => setGem(g)}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-2xl border text-xs font-medium transition ${
              gem === g ? 'border-accent/60 bg-surface-strong text-ink' : 'border-line text-subtle hover:text-ink-2'
            }`}
          >
            <span className={`h-2.5 w-2.5 rotate-45 rounded-[3px] ${GEM_BG[g]}`} aria-hidden />
            {GEMS[g].short}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1.5 flex justify-between text-xs text-subtle">
          <label htmlFor="swap-amount">Amount</label>
          <span className="num">Balance {formatInt(have)}</span>
        </div>
        <div className="flex gap-2">
          <input
            id="swap-amount"
            inputMode="numeric"
            placeholder="0"
            className="field display num min-h-[52px] w-full rounded-2xl px-4 text-2xl"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
          />
          <Button variant="ghost" onClick={() => setAmount(String(have))} disabled={have < 1}>
            Max
          </Button>
        </div>
      </div>

      <dl className="space-y-2 rounded-2xl bg-black/20 p-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">You receive</dt>
          <dd className="num font-semibold">{formatHgem(microToHgem(outMicro))} HGEM</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Rate per {GEMS[gem].short}</dt>
          <dd className="num">{formatHgem(swap.perGem[gem])} HGEM</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Community rate factor</dt>
          <dd className="num">×{swap.factor.toFixed(2)}</dd>
        </div>
      </dl>

      <div className="space-y-3 text-xs text-subtle">
        <div>
          <div className="mb-1 flex justify-between">
            <span>Your daily limit</span>
            <span className="num">
              {formatHgem(microToHgem(swap.userUsedMicro))} / {formatHgem(microToHgem(swap.userCapMicro))} HGEM
            </span>
          </div>
          <Bar value={swap.userUsedMicro} max={swap.userCapMicro} label="Your daily swap limit" />
        </div>
        <div>
          <div className="mb-1 flex justify-between">
            <span>Community daily cap used</span>
            <span className="num">{(globalFill * 100).toFixed(1)}%</span>
          </div>
          <Bar value={swap.globalUsedMicro} max={swap.globalCapMicro} tone="success" label="Community daily cap" />
        </div>
      </div>

      {overCap && <Notice tone="warn">That swap is above your remaining daily limit. Try a smaller amount.</Notice>}
      <Button className="w-full" disabled={!valid || overCap || outMicro < 1} loading={busy} onClick={() => void submit()}>
        <ArrowLeftRight className="h-4 w-4" aria-hidden />
        Sign and swap
      </Button>
    </Card>
  )
}

function ClaimCard() {
  const { snapshot, token, address, refresh } = useGame()
  const reads = useHubReads(address as `0x${string}` | undefined)
  const { send, busy } = useHubTx()
  const { writeContractAsync } = useWriteContract()
  const { signAction } = useGame()
  const [preparing, setPreparing] = useState(false)
  if (!snapshot) return null

  const earnedMicro = snapshot.swap.earnedMicro
  const claimedMicro = Number(reads.claimed / 10n ** 12n)
  const waitingMicro = Math.max(0, earnedMicro - claimedMicro)

  const claim = async () => {
    const hub = HUB_ADDRESS
    if (!hub || !token) return
    setPreparing(true)
    try {
      const sig = await signAction('claim', 'all')
      const v = await apiRequest<VoucherResponse>('POST', '/voucher', { token, body: sig })
      setPreparing(false)
      const ok = await send('Claim HGEM', () =>
        writeContractAsync({
          address: hub,
          abi: HUB_ABI,
          functionName: 'claim',
          args: [BigInt(v.cumulative), BigInt(v.deadline), v.signature],
          chainId: HUB_CHAIN_ID,
        }),
      )
      if (ok) {
        await reads.refetch()
        await refresh()
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : friendlyError(err))
    } finally {
      setPreparing(false)
    }
  }

  return (
    <Card className="space-y-4">
      <SectionTitle title="Claim to your wallet" hint="Swapped HGEM is minted to your wallet by the contract after a backend-signed voucher." />
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { k: 'Swapped', v: formatHgem(microToHgem(earnedMicro)) },
          { k: 'Claimed', v: formatHgem(microToHgem(claimedMicro)) },
          { k: 'Waiting', v: formatHgem(microToHgem(waitingMicro)) },
        ].map(({ k, v }) => (
          <div key={k} className="rounded-2xl bg-black/20 px-2 py-3">
            <p className="text-[11px] uppercase tracking-[0.06em] text-subtle">{k}</p>
            <p className="display num text-lg font-semibold">{v}</p>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted num">
        Wallet balance: <span className="font-semibold text-ink">{formatHgem(Number(reads.balance / 10n ** 12n) / 1_000_000)} HGEM</span>
      </p>
      {!reads.configured && <Notice tone="warn">The HGEM contract address is not configured yet, so claiming is offline.</Notice>}
      {reads.paused && <Notice tone="warn">Claims are paused by the contract owner right now.</Notice>}
      <Button
        className="w-full"
        disabled={!reads.configured || reads.paused || waitingMicro < 1}
        loading={preparing || busy}
        onClick={() => void claim()}
      >
        <ArrowDownToLine className="h-4 w-4" aria-hidden />
        {waitingMicro < 1 ? 'Nothing to claim' : 'Claim HGEM'}
      </Button>
      <p className="text-xs text-subtle">You need a little Sepolia ETH for gas. Claiming never spends your gems.</p>
      {HUB_ADDRESS && (
        <a
          href={buildAddressExplorerUrl(HUB_CHAIN_ID, HUB_ADDRESS)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent-hover"
        >
          View contract on Etherscan <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      )}
    </Card>
  )
}

export function SwapPanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SwapCard />
      <ClaimCard />
    </div>
  )
}
