import { motion } from 'framer-motion'
import { Flame, Gauge, Pickaxe, Zap } from 'lucide-react'
import { GEMS, GEM_IDS, TIERS, TIER_IDS, MAX_LEVEL } from '@/game/config'
import { useGame } from '@/hooks/useGame'
import { formatInt, formatNum } from '@/lib/format'
import { Bar, Card, GemAmount, SectionTitle, Stat } from './ui'

export function MinePanel() {
  const { live, liveView, tap, pendingTaps } = useGame()
  if (!live || !liveView) return null

  const totalGems = GEM_IDS.reduce((sum, g) => sum + live.gems[g], 0)
  const energyEmpty = liveView.energy < 1
  const xpSpan = Math.max(1, liveView.xpNext - liveView.xpFloor)
  const mult = liveView.multiplier

  const perHour = GEM_IDS.map((gem) => ({
    gem,
    rate: TIER_IDS.filter((t) => TIERS[t].gem === gem).reduce((s, t) => s + liveView.ratesPerHour[t], 0),
  }))

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
      <Card className="flex flex-col items-center text-center">
        <p className="text-xs font-medium uppercase tracking-[0.1em] text-subtle">Total gems</p>
        <p className="display num mt-1 text-5xl font-semibold text-balance">{formatInt(totalGems)}</p>
        <p className="mt-1 text-sm text-muted">
          Each tap yields <span className="num font-semibold text-ink">{formatNum(liveView.tapYield)}</span> bronze at ×
          {mult.total.toFixed(2)}
        </p>

        <motion.button
          whileTap={{ scale: energyEmpty ? 1 : 0.93 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          onClick={tap}
          disabled={energyEmpty}
          aria-label="Tap to mine bronze gems"
          className="mt-6 grid h-44 w-44 select-none place-items-center rounded-full border border-line bg-surface-strong text-ink shadow-[0_0_0_10px_rgba(172,198,233,0.07)] transition disabled:opacity-40"
        >
          <span className="flex flex-col items-center gap-1">
            <Pickaxe className="h-14 w-14 text-accent" aria-hidden />
            <span className="display text-sm font-semibold">{energyEmpty ? 'Recharging' : 'Tap to mine'}</span>
          </span>
        </motion.button>
        {pendingTaps > 0 && <p className="mt-2 text-xs text-subtle">Syncing {pendingTaps} taps…</p>}

        <div className="mt-6 w-full space-y-4 text-left">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-1.5 text-muted">
                <Zap className="h-4 w-4 text-gold" aria-hidden /> Energy
              </span>
              <span className="num font-semibold">
                {liveView.energy} / {liveView.energyMax}
              </span>
            </div>
            <Bar value={liveView.energy} max={liveView.energyMax} tone="gold" label="Energy" />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="text-muted">Level {liveView.level}</span>
              <span className="num text-subtle">
                {liveView.level >= MAX_LEVEL ? 'Max level' : `${formatInt(liveView.xp - liveView.xpFloor)} / ${formatInt(xpSpan)} XP`}
              </span>
            </div>
            <Bar value={liveView.xp - liveView.xpFloor} max={xpSpan} label="Experience" />
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Hash power" value={formatInt(liveView.hashPower)} sub="from all hamsters" />
          <Stat label="Multiplier" value={`×${mult.total.toFixed(2)}`} sub="applies to all mining" />
        </div>

        <Card>
          <SectionTitle title="Gem vault" hint="Hamsters keep mining while you are away, up to 8 hours per visit." />
          <ul className="grid gap-2">
            {perHour.map(({ gem, rate }) => (
              <li key={gem} className="flex items-center justify-between rounded-2xl bg-black/20 px-3 py-2.5">
                <div>
                  <GemAmount gem={gem} amount={live.gems[gem]} className="text-base" />
                  <p className="mt-0.5 text-xs text-subtle">{GEMS[gem].blurb}</p>
                </div>
                <p className="num text-right text-xs text-muted">{rate > 0 ? `+${formatNum(rate)} / hr` : 'refine only'}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <SectionTitle title="Multiplier" hint="Stack bonuses to mine faster." />
          <dl className="space-y-2 text-sm">
            {[
              { label: 'Level bonus', value: mult.level, icon: Gauge },
              { label: 'Check-in streak', value: mult.streak, icon: Flame },
              { label: 'Daily quests', value: mult.quests, icon: Pickaxe },
              { label: 'Staked HGEM', value: mult.stake, icon: Zap },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-center justify-between">
                <dt className="inline-flex items-center gap-2 text-muted">
                  <Icon className="h-4 w-4 text-subtle" aria-hidden /> {label}
                </dt>
                <dd className="num font-semibold">+{(value * 100).toFixed(0)}%</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  )
}
