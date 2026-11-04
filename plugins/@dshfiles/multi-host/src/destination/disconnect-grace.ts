import { useEffect, useState } from 'react'

type HostTone = 'online' | 'idle' | 'error'
type HostToneState = { readonly tone: HostTone; readonly label: string }

/** How long a host that just answered may fail before it turns red, so a short network blip does not flash. */
const DISCONNECT_GRACE_MS = 10_000

const RECONNECTING: HostToneState = { tone: 'idle', label: 'Reconnecting…' }

/** Milliseconds left before a failure since `lastOnlineAt` shows as one; 0 once the window closed. */
const graceRemaining = (input: { readonly lastOnlineAt: number; readonly now: number }): number =>
  Math.max(0, input.lastOnlineAt + DISCONNECT_GRACE_MS - input.now)

/** The host state, reading as reconnecting while a host that was online moments ago starts failing. */
const useDisconnectGrace = (state: HostToneState): HostToneState => {
  const [lastOnlineAt, setLastOnlineAt] = useState<number | undefined>(undefined)
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => {
    if (state.tone !== 'online') return
    setLastOnlineAt(Date.now())
    setGraceOver(false)
  }, [state.tone])
  useEffect(() => {
    if (state.tone !== 'error' || lastOnlineAt === undefined) return
    const remaining = graceRemaining({ lastOnlineAt, now: Date.now() })
    const timer = setTimeout(() => setGraceOver(true), remaining)
    return () => clearTimeout(timer)
  }, [state.tone, lastOnlineAt])
  return state.tone === 'error' && lastOnlineAt !== undefined && !graceOver ? RECONNECTING : state
}

export class DisconnectGrace {
  static readonly windowMs = DISCONNECT_GRACE_MS
  static readonly remaining = graceRemaining
  static readonly use = useDisconnectGrace
}
