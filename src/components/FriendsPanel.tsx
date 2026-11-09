import { useEffect, useState } from 'react'
import { Check, Copy, Share2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useGame } from '@/hooks/useGame'
import { formatNum } from '@/lib/format'
import { buildShareLink } from '@/lib/share'
import { Bar, Button, Card, GemAmount, SectionTitle, Stat } from './ui'

export function FriendsPanel() {
  const { snapshot } = useGame()
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const code = snapshot?.referral.code

  useEffect(() => {
    if (!code) return
    let live = true
    void buildShareLink(`/?ref=${code}`).then((url) => {
      if (live) setLink(url)
    })
    return () => {
      live = false
    }
  }, [code])

  if (!snapshot) return null
  const r = snapshot.referral

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('Invite link copied')
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.')
    }
  }

  const share = async () => {
    if (!link) return
    if (typeof navigator.share !== 'function') return void copy()
    try {
      await navigator.share({ title: 'Hamster Gems', text: 'Join my hamster mining crew.', url: link })
    } catch {
      /* dismissed */
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4">
        <SectionTitle title="Invite friends" hint={`You earn ${r.sharePct}% of the bronze value your friends mine, on top of what they keep.`} />
        <div>
          <p className="mb-1.5 text-xs text-subtle">Your invite code</p>
          <p className="display mono rounded-2xl bg-black/20 px-4 py-3 text-2xl font-semibold tracking-[0.2em]">{r.code}</p>
        </div>
        <div>
          <p className="mb-1.5 text-xs text-subtle">Invite link</p>
          <input readOnly aria-label="Invite link" value={link ?? 'Preparing link…'} className="field mono min-h-[44px] w-full rounded-2xl px-3 text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" disabled={!link} onClick={() => void copy()}>
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button disabled={!link} onClick={() => void share()}>
            <Share2 className="h-4 w-4" aria-hidden />
            Share
          </Button>
        </div>
      </Card>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Friends joined" value={r.invited} />
          <Stat label="Lifetime earned" value={formatNum(r.income)} sub="bronze" />
        </div>
        <Card className="space-y-3">
          <SectionTitle title="Today" />
          <div className="flex items-center justify-between text-sm">
            <span className="inline-flex items-center gap-2 text-muted">
              <UserPlus className="h-4 w-4 text-subtle" aria-hidden /> Referral income
            </span>
            <GemAmount gem="bronze" amount={r.earnedToday} />
          </div>
          <Bar value={r.earnedToday} max={r.dailyCap} tone="success" label="Daily referral cap" />
          <p className="text-xs text-subtle num">Daily cap {formatNum(r.dailyCap)} bronze. It resets at 00:00 UTC.</p>
        </Card>
      </div>
    </div>
  )
}
