/**
 * What the session tab shows. One turn's trace lookup is a phase of that, not a second state beside it: a lookup can
 * never still be running while a trace is open, and a missing turn can never hide behind one.
 */
export type SessionReading =
  | { readonly kind: 'idle' }
  | { readonly kind: 'seeking'; readonly turn: number; readonly since: number }
  | { readonly kind: 'missing'; readonly turn: number }
  | { readonly kind: 'trace'; readonly traceId: string }

/** A just-finished turn is exported a moment later, so the lookup retries until the wait runs out. */
export const TURN_TRACE_RETRY_MS = 1_500
export const TURN_TRACE_WAIT_MS = 20_000

export const SessionReadingModel = {
  idle: (): SessionReading => ({ kind: 'idle' }),
  seek: (input: { readonly turn: number; readonly now: number }): SessionReading => ({ kind: 'seeking', turn: input.turn, since: input.now }),
  open: (traceId: string): SessionReading => ({ kind: 'trace', traceId }),
  /** The lookup settles once: the turn's trace lands, the read failed, or the wait expired with nothing recorded. */
  settle: (input: {
    readonly reading: SessionReading
    readonly foundTraceId: string | null
    readonly failed: boolean
    readonly now: number
  }): SessionReading => {
    if (input.reading.kind !== 'seeking') return input.reading
    if (input.foundTraceId !== null) return { kind: 'trace', traceId: input.foundTraceId }
    if (!input.failed && input.now - input.reading.since < TURN_TRACE_WAIT_MS) return input.reading
    return { kind: 'missing', turn: input.reading.turn }
  },
  seekingTurn: (reading: SessionReading): number | null => (reading.kind === 'seeking' ? reading.turn : null),
  missingTurn: (reading: SessionReading): number | null => (reading.kind === 'missing' ? reading.turn : null),
  traceId: (reading: SessionReading): string | null => (reading.kind === 'trace' ? reading.traceId : null),
}
