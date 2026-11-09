import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { toast } from 'sonner'
import { settle, viewOf, type PlayerView } from '@/game/engine'
import type { PlayerState } from '@/game/types'
import { ApiError, apiRequest, friendlyError } from '@/lib/api'
import { actionMessage } from '@/lib/messages'
import type { Snapshot } from '@/lib/types'

type Status = 'idle' | 'signing' | 'loading' | 'ready' | 'error'

interface GameApi {
  address: string | undefined
  status: Status
  snapshot: Snapshot | null
  /** Passive earnings and energy projected to this instant, plus optimistic taps. */
  live: PlayerState | null
  liveView: PlayerView | null
  signedIn: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  /** POST a game action, update the snapshot and toast friendly errors. Returns true on success. */
  act: (path: string, body?: unknown, successMessage?: string) => Promise<boolean>
  /** Signs a high-value action message with the wallet, bound to the current action nonce. */
  signAction: (action: string, details: string) => Promise<{ nonce: number; signature: `0x${string}` }>
  token: string | null
  tap: () => void
  pendingTaps: number
}

const GameContext = createContext<GameApi | null>(null)

const tokenKey = (address: string) => `hg:token:${address.toLowerCase()}`

export function GameProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [tokenVersion, setTokenVersion] = useState(0)
  const [stored, setStored] = useState<{ address: string; data: Snapshot; at: number } | null>(null)
  const [flag, setFlag] = useState<'signing' | 'error' | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [pendingTaps, setPendingTaps] = useState(0)
  const seq = useRef(0)
  const pending = useRef(0)
  const flushing = useRef(false)
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushRef = useRef<() => void>(() => undefined)

  // The session token is read from storage, keyed by wallet; the version bumps when it changes.
  const token = useMemo(
    () => (address ? localStorage.getItem(tokenKey(address)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [address, tokenVersion],
  )

  const adopt = useCallback(
    (data: Snapshot) => {
      if (address) setStored({ address: address.toLowerCase(), data, at: Date.now() })
    },
    [address],
  )

  const dropSession = useCallback((addr?: string) => {
    if (addr) localStorage.removeItem(tokenKey(addr))
    setTokenVersion((v) => v + 1)
    setStored(null)
    pending.current = 0
    setPendingTaps(0)
    setFlag(null)
  }, [])

  const refresh = useCallback(async () => {
    if (!token || !address) return
    const mine = ++seq.current
    try {
      const data = await apiRequest<Snapshot>('GET', '/me', { token })
      if (mine === seq.current) {
        adopt(data)
        setFlag(null)
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === 'SESSION_EXPIRED')) {
        dropSession(address)
        toast.info('Session expired. Sign in again to keep mining.')
      } else if (!(err instanceof ApiError && err.status === 429) && mine === seq.current) {
        setFlag('error')
      }
    }
  }, [token, address, adopt, dropSession])

  useEffect(() => {
    if (!token) return
    const first = setTimeout(() => void refresh(), 0)
    const id = setInterval(() => void refresh(), 6000)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [token, refresh])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const signIn = useCallback(async () => {
    if (!address) return
    setFlag('signing')
    try {
      const n = await apiRequest<{ message: string }>('POST', '/auth/nonce', { body: { address } })
      const signature = await signMessageAsync({ message: n.message })
      const ref = sessionStorage.getItem('hg:ref') ?? undefined
      const v = await apiRequest<{ token: string }>('POST', '/auth/verify', { body: { address, signature, ref } })
      localStorage.setItem(tokenKey(address), v.token)
      setTokenVersion((n2) => n2 + 1)
      setFlag(null)
    } catch (err) {
      setFlag(null)
      toast.error(friendlyError(err))
    }
  }, [address, signMessageAsync])

  const signOut = useCallback(async () => {
    if (token) await apiRequest('POST', '/auth/logout', { token, body: {} }).catch(() => undefined)
    dropSession(address)
  }, [token, address, dropSession])

  const act = useCallback(
    async (path: string, body?: unknown, successMessage?: string) => {
      if (!token) return false
      try {
        const res = await apiRequest<Snapshot>('POST', path, { token, body: body ?? {} })
        seq.current += 1
        if (res.state) adopt(res)
        if (successMessage) toast.success(successMessage)
        return true
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) dropSession(address)
        toast.error(friendlyError(err))
        return false
      }
    },
    [token, adopt, dropSession, address],
  )

  const signAction = useCallback(
    async (action: string, details: string) => {
      if (!address || !stored) throw new Error('Not signed in')
      const nonce = stored.data.actionNonce
      const signature = await signMessageAsync({ message: actionMessage(address, action, details, nonce) })
      return { nonce, signature }
    },
    [address, stored, signMessageAsync],
  )

  const flush = useCallback(async () => {
    flushTimer.current = null
    if (flushing.current || !token || pending.current < 1) return
    flushing.current = true
    const count = Math.min(50, pending.current)
    try {
      const res = await apiRequest<Snapshot>('POST', '/tap', { token, body: { count } })
      seq.current += 1
      adopt(res)
    } catch (err) {
      pending.current = 0
      if (err instanceof ApiError && err.code !== 'TOO_FAST' && err.code !== 'RATE_LIMITED') toast.error(friendlyError(err))
      void refresh()
    } finally {
      pending.current = Math.max(0, pending.current - count)
      setPendingTaps(pending.current)
      flushing.current = false
      if (pending.current > 0) flushTimer.current = setTimeout(() => flushRef.current(), 450)
    }
  }, [token, adopt, refresh])

  useEffect(() => {
    flushRef.current = () => void flush()
  }, [flush])

  const tap = useCallback(() => {
    if (!token) return
    pending.current += 1
    setPendingTaps(pending.current)
    if (!flushTimer.current) flushTimer.current = setTimeout(() => flushRef.current(), 450)
  }, [token])

  useEffect(
    () => () => {
      if (flushTimer.current) clearTimeout(flushTimer.current)
    },
    [],
  )

  const current = stored && address && stored.address === address.toLowerCase() ? stored : null
  const status: Status = !address
    ? 'idle'
    : flag === 'signing'
      ? 'signing'
      : current
        ? 'ready'
        : token
          ? flag === 'error'
            ? 'error'
            : 'loading'
          : 'idle'

  const snapshot = current?.data ?? null
  const ctx = useMemo(() => ({ stakeBoost: snapshot?.view.multiplier.stake ?? 0 }), [snapshot])

  const live = useMemo(() => {
    if (!current) return null
    const t = current.data.serverTime + (now - current.at)
    const base = settle(current.data.state, t, ctx).state
    if (pendingTaps === 0) return base
    const usable = Math.min(pendingTaps, Math.floor(base.energy))
    const gain = usable * current.data.view.tapYield
    return { ...base, energy: base.energy - usable, gems: { ...base.gems, bronze: base.gems.bronze + gain } }
  }, [current, now, ctx, pendingTaps])

  const liveView = useMemo(() => (live ? viewOf(live, ctx) : null), [live, ctx])

  const value: GameApi = {
    address,
    status,
    snapshot,
    live,
    liveView,
    signedIn: Boolean(token && snapshot),
    signIn,
    signOut,
    refresh,
    act,
    signAction,
    token,
    tap,
    pendingTaps,
  }
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame(): GameApi {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used inside GameProvider')
  return ctx
}
