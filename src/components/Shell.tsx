import { ConnectKitButton } from 'connectkit'
import { Gem, Hammer, ListChecks, LogOut, PawPrint, Pickaxe, Trophy, Users, Wallet, FlaskConical, ArrowLeftRight, Landmark } from 'lucide-react'
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { useGame } from '@/hooks/useGame'
import { shortAddress } from '@/lib/format'
import { Button, Card, Spinner } from './ui'

export type TabId = 'mine' | 'hamsters' | 'refine' | 'swap' | 'stake' | 'quests' | 'friends' | 'ranks'

export const TABS: { id: TabId; label: string; icon: typeof Pickaxe }[] = [
  { id: 'mine', label: 'Mine', icon: Pickaxe },
  { id: 'hamsters', label: 'Hamsters', icon: Hammer },
  { id: 'refine', label: 'Refine', icon: FlaskConical },
  { id: 'swap', label: 'Swap', icon: ArrowLeftRight },
  { id: 'stake', label: 'Stake', icon: Landmark },
  { id: 'quests', label: 'Quests', icon: ListChecks },
  { id: 'friends', label: 'Friends', icon: Users },
  { id: 'ranks', label: 'Ranks', icon: Trophy },
]

export function Header() {
  const { liveView, signedIn, signOut, address } = useGame()
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-navy/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent text-navy">
            <PawPrint className="h-5 w-5" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="display text-base font-semibold">Hamster Gems</p>
            <p className="text-xs text-subtle">
              {signedIn && liveView ? `Level ${liveView.level} on Sepolia` : 'Mining on Sepolia'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConnectKitButton.Custom>
            {({ isConnected, show }) => (
              <Button variant="ghost" onClick={show} className="px-3">
                <Wallet className="h-4 w-4" aria-hidden />
                {isConnected && address ? shortAddress(address) : 'Connect'}
              </Button>
            )}
          </ConnectKitButton.Custom>
          {signedIn && (
            <Button variant="ghost" className="px-3" onClick={() => void signOut()} aria-label="Sign out">
              <LogOut className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}

export function TabBar({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  return (
    <nav
      aria-label="Sections"
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-navy/90 backdrop-blur-xl"
    >
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 pt-2 [scrollbar-width:none]">
        {TABS.map(({ id, label, icon: Icon }) => (
          <li key={id} className="min-w-[64px] flex-1">
            <button
              onClick={() => onChange(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={clsx(
                'flex min-h-[48px] w-full flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-[11px] font-medium transition',
                tab === id ? 'bg-surface-strong text-ink' : 'text-subtle hover:text-ink-2',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Renders children only for a signed-in player; otherwise guides the player to connect and sign. */
export function Gate({ children }: { children: ReactNode }) {
  const { address, status, signedIn, signIn } = useGame()
  if (signedIn) return <>{children}</>
  if (address && (status === 'loading' || status === 'signing')) {
    return <Spinner label={status === 'signing' ? 'Waiting for your signature…' : 'Loading your burrow…'} />
  }
  return (
    <Card className="mx-auto mt-6 max-w-md text-center">
      <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-accent text-navy">
        <Gem className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="display text-balance text-2xl font-semibold">Put your hamsters to work</h1>
      <p className="mx-auto mt-2 max-w-[34ch] text-pretty text-sm text-muted">
        Connect your wallet and sign one free message to start mining. Signing never moves funds.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {address ? (
          <Button onClick={() => void signIn()}>Sign in to play</Button>
        ) : (
          <ConnectKitButton.Custom>
            {({ show }) => (
              <Button onClick={show}>
                <Wallet className="h-4 w-4" aria-hidden />
                Connect wallet
              </Button>
            )}
          </ConnectKitButton.Custom>
        )}
      </div>
      {status === 'error' && <p className="mt-3 text-sm text-danger">Could not reach the game server. Retrying…</p>}
    </Card>
  )
}
