import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'
import { GEMS, type GemId } from '@/game/config'
import { formatNum } from '@/lib/format'

export const GEM_TEXT: Record<GemId, string> = {
  bronze: 'text-bronze',
  silver: 'text-silver',
  gold: 'text-gold',
  royal: 'text-royal',
}

export const GEM_BG: Record<GemId, string> = {
  bronze: 'bg-bronze',
  silver: 'bg-silver',
  gold: 'bg-gold',
  royal: 'bg-royal',
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx('glass rounded-3xl p-4 sm:p-5', className)}>{children}</section>
}

export function SectionTitle({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="display text-lg font-semibold text-ink">{title}</h2>
        {hint && <p className="text-pretty text-sm text-subtle">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

type Variant = 'primary' | 'ghost' | 'danger'

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'primary' && 'bg-accent text-navy hover:bg-accent-hover',
        variant === 'ghost' && 'border border-line bg-surface text-ink hover:bg-surface-strong',
        variant === 'danger' && 'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
        className,
      )}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function Bar({ value, max, tone = 'accent', label }: { value: number; max: number; tone?: 'accent' | 'success' | 'gold'; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className="h-2.5 w-full overflow-hidden rounded-full bg-black/30"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clsx('h-full rounded-full transition-[width] duration-500', tone === 'accent' && 'bg-accent', tone === 'success' && 'bg-success', tone === 'gold' && 'bg-gold')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function GemAmount({ gem, amount, className }: { gem: GemId; amount: number; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 num', className)} title={GEMS[gem].name}>
      <span className={clsx('inline-block h-2.5 w-2.5 rotate-45 rounded-[3px]', GEM_BG[gem])} aria-hidden />
      <span className="font-semibold text-ink">{formatNum(amount)}</span>
      <span className="text-xs text-subtle">{GEMS[gem].short}</span>
    </span>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl bg-black/20 p-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-subtle">{label}</p>
      <p className="display num mt-0.5 text-xl font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-subtle">{sub}</p>}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <p
      className={clsx(
        'text-pretty rounded-2xl border px-3 py-2.5 text-sm',
        tone === 'info' ? 'border-line bg-black/20 text-muted' : 'border-gold/30 bg-gold/10 text-gold',
      )}
    >
      {children}
    </p>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-subtle" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}
