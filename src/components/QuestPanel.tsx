import { useState } from 'react'
import { CalendarCheck, Check, Flame } from 'lucide-react'
import { STREAK_BOOST_MAX_DAYS } from '@/game/config'
import { useGame } from '@/hooks/useGame'
import { formatNum } from '@/lib/format'
import { Bar, Button, Card, GemAmount, SectionTitle } from './ui'

export function QuestPanel() {
  const { snapshot, live, act } = useGame()
  const [busy, setBusy] = useState<string | null>(null)
  if (!snapshot || !live) return null

  const run = async (key: string, path: string, body: unknown, message: string) => {
    setBusy(key)
    await act(path, body, message)
    setBusy(null)
  }

  const streak = live.streak
  const checkedIn = live.daily.checkedIn
  const nextStreak = Math.min(checkedIn ? streak : streak + 1, STREAK_BOOST_MAX_DAYS)
  const reward = 100 + 50 * nextStreak

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
      <Card className="space-y-4">
        <SectionTitle title="Daily check-in" hint="Keep your streak alive for a bigger reward and +1% mining per day, up to 30%." />
        <div className="flex items-center gap-3 rounded-2xl bg-black/20 p-4">
          <Flame className="h-8 w-8 text-gold" aria-hidden />
          <div>
            <p className="display num text-3xl font-semibold">{streak}</p>
            <p className="text-xs text-subtle">day streak</p>
          </div>
        </div>
        <Button
          className="w-full"
          disabled={checkedIn}
          loading={busy === 'checkin'}
          onClick={() => void run('checkin', '/checkin', {}, `Checked in. +${formatNum(reward)} bronze`)}
        >
          <CalendarCheck className="h-4 w-4" aria-hidden />
          {checkedIn ? 'Come back tomorrow (00:00 UTC)' : `Check in for ${formatNum(reward)} bronze`}
        </Button>
      </Card>

      <Card className="space-y-3">
        <SectionTitle title="Daily quests" hint="Each claimed quest adds +5% mining until 00:00 UTC." />
        <ul className="space-y-3">
          {snapshot.quests.map((q) => {
            const done = q.progress >= q.target
            return (
              <li key={q.id} className="rounded-2xl bg-black/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{q.title}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-subtle">
                      <GemAmount gem="bronze" amount={q.rewardBronze} />
                      <span className="num">+{q.rewardXp} XP</span>
                    </p>
                  </div>
                  {q.claimed ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                      <Check className="h-4 w-4" aria-hidden /> Claimed
                    </span>
                  ) : (
                    <Button
                      className="min-h-[40px] shrink-0 px-3"
                      variant={done ? 'primary' : 'ghost'}
                      disabled={!done}
                      loading={busy === q.id}
                      onClick={() => void run(q.id, '/quests/claim', { id: q.id }, 'Quest reward claimed')}
                    >
                      Claim
                    </Button>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-3">
                  <div className="flex-1">
                    <Bar value={q.progress} max={q.target} tone={done ? 'success' : 'accent'} label={q.title} />
                  </div>
                  <span className="num text-xs text-subtle">
                    {q.progress}/{q.target}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
