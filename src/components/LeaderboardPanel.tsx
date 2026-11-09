import { useCallback, useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { clsx } from 'clsx'
import { levelFromXp } from '@/game/engine'
import { useGame } from '@/hooks/useGame'
import { apiRequest } from '@/lib/api'
import { formatInt } from '@/lib/format'
import type { LeaderboardResponse } from '@/lib/types'
import { Card, SectionTitle, Spinner } from './ui'

export function LeaderboardPanel() {
  const { token } = useGame()
  const [by, setBy] = useState<'gems' | 'xp'>('gems')
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<LeaderboardResponse>('GET', `/leaderboard?by=${by}`, { token }))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [by, token])

  useEffect(() => {
    const first = setTimeout(() => void load(), 0)
    const id = setInterval(() => void load(), 10_000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [load])

  return (
    <div className="space-y-4">
      <SectionTitle
        title="Global leaderboard"
        hint={data ? `${formatInt(data.players)} players. Refreshes every 10 seconds.` : 'Loading players…'}
        right={
          <div className="flex rounded-2xl border border-line p-1" role="tablist" aria-label="Sort by">
            {(['gems', 'xp'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={by === k}
                onClick={() => setBy(k)}
                className={clsx('min-h-[36px] rounded-xl px-3 text-sm font-medium', by === k ? 'bg-surface-strong text-ink' : 'text-subtle')}
              >
                {k === 'gems' ? 'Gems mined' : 'XP'}
              </button>
            ))}
          </div>
        }
      />
      {!data && !failed && <Spinner label="Loading ranks…" />}
      {failed && !data && <p className="text-sm text-danger">Could not load the leaderboard. Retrying…</p>}
      {data && (
        <Card className="p-2 sm:p-3">
          {data.you && <p className="px-3 py-2 text-sm text-muted">Your rank: <span className="num font-semibold text-ink">#{formatInt(data.you.rank)}</span></p>}
          {data.rows.length === 0 && <p className="px-3 py-6 text-center text-sm text-subtle">No miners yet. Be the first.</p>}
          <ol className="divide-y divide-line">
            {data.rows.map((r) => (
              <li key={r.rank} className={clsx('flex items-center gap-3 rounded-2xl px-3 py-3', r.isYou && 'bg-surface-strong')}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-black/25 text-sm font-semibold num">
                  {r.rank <= 3 ? <Trophy className={clsx('h-4 w-4', r.rank === 1 ? 'text-gold' : r.rank === 2 ? 'text-silver' : 'text-bronze')} aria-hidden /> : r.rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="mono truncate text-sm text-ink">
                    {r.address} {r.isYou && <span className="ml-1 font-sans text-xs text-accent">you</span>}
                  </p>
                  <p className="num text-xs text-subtle">
                    Level {levelFromXp(r.xp)} · Hash {formatInt(r.hashPower)}
                  </p>
                </div>
                <p className="display num text-right text-base font-semibold">
                  {by === 'gems' ? formatInt(r.totalMined) : formatInt(r.xp)}
                  <span className="ml-1 text-xs font-normal text-subtle">{by === 'gems' ? 'value' : 'XP'}</span>
                </p>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}
