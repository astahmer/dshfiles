import { useEffect, useMemo, useReducer, useState } from 'react'

type HostTone = 'online' | 'idle' | 'error'
type HostToneState = { readonly tone: HostTone; readonly label: string }

/** How long a host that just answered may fail before it turns red, so a short network blip does not flash. */
const DISCONNECT_GRACE_MS = 10_000

const RECONNECTING: HostToneState = { tone: 'idle', label: 'Reconnecting…' }

/** Milliseconds left before a failure since `lastOnlineAt` shows as one; 0 once the window closed. */
const graceRemaining = (input: { readonly lastOnlineAt: number; readonly now: number }): number =>
  Math.max(0, input.lastOnlineAt + DISCONNECT_GRACE_MS - input.now)

/** Where a host stands in the grace window: it never answered, it answered inside the window, or the window closed. */
export type GracePhase =
  | { readonly phase: 'unseen' }
  | { readonly phase: 'grace'; readonly lastOnlineAt: number }
  | { readonly phase: 'failed'; readonly lastOnlineAt: number }

/** One host observation, or the timer announcing the window is over. */
export type GraceEvent = { readonly kind: 'online'; readonly at: number } | { readonly kind: 'failure'; readonly at: number } | { readonly kind: 'elapsed' }

const UNSEEN: GracePhase = { phase: 'unseen' }

/** Advance the window: a good answer refreshes it, a failure keeps it while time remains, and elapsed closes it. */
export const graceTransition = (phase: GracePhase, event: GraceEvent): GracePhase => {
  if (event.kind === 'online') return { phase: 'grace', lastOnlineAt: event.at }
  if (phase.phase === 'unseen') return phase
  if (event.kind === 'elapsed') return { phase: 'failed', lastOnlineAt: phase.lastOnlineAt }
  return phase.phase === 'grace' && graceRemaining({ lastOnlineAt: phase.lastOnlineAt, now: event.at }) > 0
    ? phase
    : { phase: 'failed', lastOnlineAt: phase.lastOnlineAt }
}

/** The host state to show: a failure still inside a recently refreshed window reads as reconnecting. */
export const graceDisplay = (input: { readonly state: HostToneState; readonly phase: GracePhase; readonly now: number }): HostToneState =>
  input.state.tone === 'error' && input.phase.phase === 'grace' && graceRemaining({ lastOnlineAt: input.phase.lastOnlineAt, now: input.now }) > 0
    ? RECONNECTING
    : input.state

/** The host state, reading as reconnecting while a host that was online moments ago starts failing. */
const useDisconnectGrace = (state: HostToneState): HostToneState => {
  const [phase, dispatch] = useReducer(graceTransition, UNSEEN)
  // The render reads the last observed time only; the observations themselves happen in the effects below.
  const [now, setNow] = useState(0)
  // Every online observation moves the window: a host that keeps answering keeps the full grace period.
  useEffect(() => {
    const at = Date.now()
    setNow(at)
    if (state.tone === 'online') dispatch({ kind: 'online', at })
    else if (state.tone === 'error') dispatch({ kind: 'failure', at })
  }, [state.tone, state.label])
  useEffect(() => {
    if (state.tone !== 'error' || phase.phase !== 'grace') return
    const remaining = graceRemaining({ lastOnlineAt: phase.lastOnlineAt, now: Date.now() })
    if (remaining === 0) return
    const timer = setTimeout(() => {
      dispatch({ kind: 'elapsed' })
    }, remaining)
    return () => {
      clearTimeout(timer)
    }
  }, [state.tone, phase])
  return useMemo(() => graceDisplay({ state, phase, now }), [state, phase, now])
}

export class DisconnectGrace {
  static readonly windowMs = DISCONNECT_GRACE_MS
  static readonly remaining = graceRemaining
  static readonly transition = graceTransition
  static readonly display = graceDisplay
  static readonly use = useDisconnectGrace
}
