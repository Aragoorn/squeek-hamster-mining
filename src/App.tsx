import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GameProvider } from '@/hooks/useGame'
import { FriendsPanel } from '@/components/FriendsPanel'
import { HamsterPanel } from '@/components/HamsterPanel'
import { LeaderboardPanel } from '@/components/LeaderboardPanel'
import { MinePanel } from '@/components/MinePanel'
import { QuestPanel } from '@/components/QuestPanel'
import { RefinePanel } from '@/components/RefinePanel'
import { Gate, Header, TabBar, type TabId } from '@/components/Shell'
import { StakePanel } from '@/components/StakePanel'
import { SwapPanel } from '@/components/SwapPanel'

const REF_RE = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{8}$/

function Panel({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'mine':
      return <MinePanel />
    case 'hamsters':
      return <HamsterPanel />
    case 'refine':
      return <RefinePanel />
    case 'swap':
      return <SwapPanel />
    case 'stake':
      return <StakePanel />
    case 'quests':
      return <QuestPanel />
    case 'friends':
      return <FriendsPanel />
    case 'ranks':
      return <LeaderboardPanel />
  }
}

export default function App() {
  const [tab, setTab] = useState<TabId>('mine')

  // Remember an invite code from the link so it can be applied at first sign-in.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref && REF_RE.test(ref)) sessionStorage.setItem('hg:ref', ref.toUpperCase())
  }, [])

  return (
    <GameProvider>
      <div className="min-h-dvh pb-28">
        <Header />
        <main className="mx-auto max-w-5xl px-4 py-5">
          <Gate>
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <Panel tab={tab} />
              </motion.div>
            </AnimatePresence>
          </Gate>
        </main>
        <TabBar tab={tab} onChange={setTab} />
      </div>
    </GameProvider>
  )
}
