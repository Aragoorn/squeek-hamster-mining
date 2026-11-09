import { useState } from 'react'
import { ArrowRight, FlaskConical } from 'lucide-react'
import { GEMS, REFINE, GEM_VALUE, type GemId } from '@/game/config'
import { useGame } from '@/hooks/useGame'
import { formatInt } from '@/lib/format'
import { Button, Card, GemAmount, Notice, SectionTitle } from './ui'

const FROM: Exclude<GemId, 'royal'>[] = ['bronze', 'silver', 'gold']

function Recipe({ from }: { from: Exclude<GemId, 'royal'> }) {
  const { live, act } = useGame()
  const [units, setUnits] = useState('1')
  const [busy, setBusy] = useState(false)
  if (!live) return null
  const recipe = REFINE[from]
  const have = live.gems[from]
  const max = Math.min(1000, Math.floor(have / recipe.input))
  const parsed = Number(units)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= max
  const submit = async () => {
    setBusy(true)
    await act('/refine', { from, units: parsed }, `Refined ${parsed} ${GEMS[recipe.to].name}${parsed > 1 ? 's' : ''}`)
    setBusy(false)
  }
  const loss = recipe.input * GEM_VALUE[from] - GEM_VALUE[recipe.to]

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <GemAmount gem={from} amount={recipe.input} className="text-base" />
        <ArrowRight className="h-4 w-4 text-subtle" aria-hidden />
        <GemAmount gem={recipe.to} amount={1} className="text-base" />
      </div>
      <p className="text-xs text-subtle">
        {recipe.input} {GEMS[from].name}s become one {GEMS[recipe.to].name}.{' '}
        {loss > 0 ? `A small refining loss of ${formatInt(loss)} bronze-equivalent applies.` : 'No refining loss.'}
      </p>
      <div className="flex gap-2">
        <input
          inputMode="numeric"
          aria-label={`${GEMS[recipe.to].name}s to refine`}
          className="field num min-h-[44px] w-full rounded-2xl px-3 text-base"
          value={units}
          onChange={(e) => setUnits(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
        />
        <Button variant="ghost" onClick={() => setUnits(String(Math.max(1, max)))} disabled={max < 1}>
          Max
        </Button>
      </div>
      <Button
        className="w-full"
        disabled={!valid}
        loading={busy}
        onClick={() => void submit()}
      >
        <FlaskConical className="h-4 w-4" aria-hidden />
        {max < 1 ? `Need ${recipe.input} ${GEMS[from].short}` : `Refine ${valid ? parsed : ''}`}
      </Button>
      <p className="text-xs text-subtle num">You hold {formatInt(have)} {GEMS[from].short}</p>
    </Card>
  )
}

export function RefinePanel() {
  return (
    <div className="space-y-4">
      <SectionTitle title="Refinery" hint="Merge lower gems into rarer ones. Results are fixed, never random." />
      <Notice>Royal Gems are the governance and swap gem. They can only be made here, and each is worth far more when swapped to HGEM.</Notice>
      <div className="grid gap-4 md:grid-cols-3">
        {FROM.map((g) => (
          <Recipe key={g} from={g} />
        ))}
      </div>
    </div>
  )
}
