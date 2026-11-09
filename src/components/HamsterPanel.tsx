import { useState } from 'react'
import { Lock, Plus, TrendingUp } from 'lucide-react'
import { GEMS, TIERS, TIER_IDS, type TierId } from '@/game/config'
import { hireCost, levelMult, upgradeCost } from '@/game/engine'
import { useGame } from '@/hooks/useGame'
import { formatInt, formatNum } from '@/lib/format'
import { Button, Card, GemAmount, SectionTitle } from './ui'

export function HamsterPanel() {
  const { live, liveView, act } = useGame()
  const [busy, setBusy] = useState<string | null>(null)
  if (!live || !liveView) return null

  const run = async (key: string, path: string, tier: TierId, message: string) => {
    setBusy(key)
    await act(path, { tier }, message)
    setBusy(null)
  }

  return (
    <div className="space-y-4">
      <SectionTitle title="Your hamsters" hint="Hire more hamsters or upgrade a tier. Every hamster in a tier shares its level." />
      <div className="grid gap-4 md:grid-cols-3">
        {TIER_IDS.map((id) => {
          const cfg = TIERS[id]
          const slot = live.hamsters[id]
          const locked = liveView.level < cfg.unlockLevel
          const hire = hireCost(live, id)
          const up = upgradeCost(live, id)
          const canHire = !locked && slot.count < cfg.maxCount && live.gems[hire.gem] >= hire.amount
          const canUp = slot.count > 0 && slot.level < cfg.maxLevel && live.gems[up.gem] >= up.amount
          const nextMult = levelMult(slot.level + 1) / levelMult(slot.level)
          return (
            <Card key={id} className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">Tier {id}</p>
                  <h3 className="display text-xl font-semibold">{cfg.name}</h3>
                  <p className="text-sm text-muted">Mines {GEMS[cfg.gem].name}s</p>
                </div>
                {locked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/30 px-2.5 py-1 text-xs text-subtle">
                    <Lock className="h-3.5 w-3.5" aria-hidden /> Level {cfg.unlockLevel}
                  </span>
                )}
              </div>

              <dl className="grid grid-cols-3 gap-2 text-center">
                {[
                  { k: 'Deployed', v: `${slot.count}/${cfg.maxCount}` },
                  { k: 'Level', v: `${slot.level}/${cfg.maxLevel}` },
                  { k: 'Per hour', v: formatNum(liveView.ratesPerHour[id]) },
                ].map(({ k, v }) => (
                  <div key={k} className="rounded-2xl bg-black/20 px-2 py-2">
                    <dt className="text-[11px] uppercase tracking-[0.06em] text-subtle">{k}</dt>
                    <dd className="num font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-subtle num">
                Hash power {formatInt(slot.count * cfg.baseHash * levelMult(slot.level))}
              </p>

              <div className="mt-auto grid gap-2">
                <Button
                  disabled={!canHire}
                  loading={busy === `hire${id}`}
                  onClick={() => void run(`hire${id}`, '/hamsters/hire', id, `${cfg.name} deployed`)}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Deploy
                  <GemAmount gem={hire.gem} amount={hire.amount} className="[&_*]:!text-navy" />
                </Button>
                <Button
                  variant="ghost"
                  disabled={!canUp}
                  loading={busy === `up${id}`}
                  onClick={() => void run(`up${id}`, '/hamsters/upgrade', id, `${cfg.name} upgraded`)}
                >
                  <TrendingUp className="h-4 w-4" aria-hidden />
                  {slot.level >= cfg.maxLevel ? 'Max level' : `Upgrade (+${((nextMult - 1) * 100).toFixed(0)}%)`}
                  {slot.level < cfg.maxLevel && <GemAmount gem={up.gem} amount={up.amount} />}
                </Button>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
