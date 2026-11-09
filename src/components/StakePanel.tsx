import { useState } from 'react'
import { Landmark } from 'lucide-react'
import { formatUnits, parseUnits } from 'viem'
import { useWriteContract } from 'wagmi'
import { useGame } from '@/hooks/useGame'
import { useNow } from '@/hooks/useNow'
import { useHubReads, useHubTx } from '@/hooks/useHub'
import { formatDuration, formatHgem } from '@/lib/format'
import { EARLY_EXIT_BURN_PCT, HUB_ABI, HUB_ADDRESS, HUB_CHAIN_ID, STAKE_TIERS, pendingReward, type Position, type StakeTier } from '@/lib/hub'
import { Button, Card, Notice, SectionTitle, Stat } from './ui'

const hgem = (wei: bigint) => formatHgem(Number(formatUnits(wei, 18)))

function TierCard({
  tier,
  position,
  balance,
  nowSec,
  onDone,
}: {
  tier: StakeTier
  position: Position
  balance: bigint
  nowSec: number
  onDone: () => Promise<unknown>
}) {
  const { send, busy } = useHubTx()
  const { writeContractAsync } = useWriteContract()
  const [amount, setAmount] = useState('')
  const [confirmExit, setConfirmExit] = useState(false)

  let parsed = 0n
  try {
    parsed = amount ? parseUnits(amount, 18) : 0n
  } catch {
    parsed = 0n
  }
  const validStake = parsed >= 10n ** 18n && parsed <= balance
  const open = position.amount > 0n
  const locked = open && tier.id !== 0 && nowSec < position.lockEnd
  const reward = pendingReward(position, tier, nowSec)
  const hub = HUB_ADDRESS
  if (!hub) return null

  const write = (functionName: 'stake' | 'claimReward' | 'unstake' | 'unstakeEarly') => {
    if (functionName === 'stake') {
      return writeContractAsync({ address: hub, abi: HUB_ABI, functionName, args: [parsed, tier.id], chainId: HUB_CHAIN_ID })
    }
    return writeContractAsync({ address: hub, abi: HUB_ABI, functionName, args: [tier.id], chainId: HUB_CHAIN_ID })
  }

  const run = async (label: string, fn: 'stake' | 'claimReward' | 'unstake' | 'unstakeEarly') => {
    const ok = await send(label, () => write(fn))
    if (ok) {
      setAmount('')
      setConfirmExit(false)
      await onDone()
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="display text-xl font-semibold">{tier.name}</h3>
          <p className="text-sm text-muted">
            {tier.lockDays === 0 ? 'Withdraw any time' : `Locked for ${tier.lockDays} days`}
          </p>
        </div>
        <div className="text-right">
          <p className="display num text-2xl font-semibold text-success">{(tier.aprBps / 100).toFixed(0)}%</p>
          <p className="text-xs text-subtle">APR in HGEM</p>
        </div>
      </div>
      <p className="text-xs text-subtle">Counts ×{(tier.boostBps / 10000).toFixed(2)} toward your mining boost while staked.</p>

      {open && (
        <dl className="space-y-1.5 rounded-2xl bg-black/20 p-3 text-sm num">
          <div className="flex justify-between">
            <dt className="text-muted">Staked</dt>
            <dd className="font-semibold">{hgem(position.amount)} HGEM</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Earned so far</dt>
            <dd className="font-semibold text-success">{hgem(reward)} HGEM</dd>
          </div>
          {tier.id !== 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">{locked ? 'Unlocks in' : 'Status'}</dt>
              <dd>{locked ? formatDuration(position.lockEnd - nowSec) : 'Unlocked'}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="flex gap-2">
        <input
          inputMode="decimal"
          aria-label={`HGEM to stake in ${tier.name}`}
          placeholder="Min 1 HGEM"
          className="field num min-h-[44px] w-full rounded-2xl px-3 text-base"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, '').slice(0, 14))}
        />
        <Button variant="ghost" onClick={() => setAmount(formatUnits(balance, 18))} disabled={balance < 10n ** 18n}>
          Max
        </Button>
      </div>
      <Button disabled={!validStake} loading={busy} onClick={() => void run(`Stake in ${tier.name}`, 'stake')}>
        <Landmark className="h-4 w-4" aria-hidden />
        {open ? 'Add to position' : 'Stake HGEM'}
      </Button>

      {open && (
        <div className="grid gap-2">
          <Button variant="ghost" disabled={reward === 0n} loading={busy} onClick={() => void run('Claim reward', 'claimReward')}>
            Claim reward
          </Button>
          {!locked && (
            <Button variant="ghost" loading={busy} onClick={() => void run('Unstake', 'unstake')}>
              Withdraw stake and reward
            </Button>
          )}
          {locked &&
            (confirmExit ? (
              <div className="space-y-2">
                <Notice tone="warn">
                  Leaving early forfeits all rewards and burns {EARLY_EXIT_BURN_PCT}% of your principal. This cannot be undone.
                </Notice>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="ghost" onClick={() => setConfirmExit(false)}>
                    Keep staking
                  </Button>
                  <Button variant="danger" loading={busy} onClick={() => void run('Early exit', 'unstakeEarly')}>
                    Exit now
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="danger" onClick={() => setConfirmExit(true)}>
                Exit early
              </Button>
            ))}
        </div>
      )}
    </Card>
  )
}

export function StakePanel() {
  const { address, snapshot } = useGame()
  const reads = useHubReads(address as `0x${string}` | undefined)
  const nowSec = Math.floor(useNow(1000) / 1000)

  if (!reads.configured) {
    return <Notice tone="warn">Staking is offline until the HGEM contract address is configured.</Notice>
  }

  const mine = reads.positions.reduce((s, p) => s + p.amount, 0n)
  const boost = snapshot?.view.multiplier.stake ?? 0

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Stake HGEM"
        hint="Lock HGEM for passive yield and a permanent mining boost while it stays staked."
      />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Wallet" value={hgem(reads.balance)} sub="HGEM" />
        <Stat label="Staked" value={hgem(mine)} sub="HGEM" />
        <Stat label="Mining boost" value={`+${(boost * 100).toFixed(0)}%`} sub="updates within a minute" />
      </div>
      {reads.balance < 10n ** 18n && mine === 0n && (
        <Notice>You need HGEM to stake. Swap gems on the Swap tab, then claim them to your wallet.</Notice>
      )}
      {reads.paused && <Notice tone="warn">New stakes are paused by the owner. You can still claim and withdraw.</Notice>}
      <div className="grid gap-4 md:grid-cols-2">
        {STAKE_TIERS.map((tier) => (
          <TierCard
            key={tier.id}
            tier={tier}
            position={reads.positions[tier.id]}
            balance={reads.balance}
            nowSec={nowSec}
            onDone={reads.refetch}
          />
        ))}
      </div>
    </div>
  )
}
