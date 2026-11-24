import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { LiveElapsed } from '@dshfiles/plugin-ui/components/live-elapsed'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { threadSidebarLiveTurnsApi } from './live-turns-api.js'

/**
 * The live activity line of a working thread (polish pass b:r4et): its current step with the working shimmer and a
 * ticking elapsed time ("Running pnpm test · 1m 12s"; a list row seats the clock in its time slot). Built so 20 working rows cost nothing per
 * frame: one Host read every 3 s for all of them, the kit's one page ticker (`LiveElapsed`) that writes each visible
 * clock's text directly (no React render), and a CSS shimmer phase-locked across rows that pauses off screen and under
 * reduced motion.
 */

/** One running turn, on this browser's clock. */
export interface LiveTurnView {
  /** Browser clock, epoch ms; undefined when neither the Host nor this tab saw the turn start. */
  readonly startedAt: number | undefined
  readonly step: string | null
  /** The turn waits for the user's answer: Needs you, not Working. */
  readonly needsYou?: boolean
}

const LIVE_TURNS_POLL_MS = 3_000
const EMPTY_TURNS: ReadonlyMap<string, LiveTurnView> = new Map()

/** Every shimmer starts at the same phase of the page clock, so a list of working rows sweeps in step. */
const shimmerDelay = (): string => `-${String(Math.round(('performance' in globalThis ? performance.now() : 0) % 2200))}ms`

/**
 * The working step in the shimmer, then the elapsed time. `active` false (off screen) pauses both. Colourless: the
 * spinner glyph says Working; the shimmer only shows it is live.
 */
export const LiveActivityLine = memo(
  (props: { readonly step: string; readonly startedAt: number | undefined; readonly active: boolean; readonly className?: string }): JSX.Element => {
    const phase = useMemo((): CSSProperties & { readonly '--dshx-live-shimmer-delay': string } => ({ '--dshx-live-shimmer-delay': shimmerDelay() }), [])
    return (
      <span className={cn('dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1', props.className)} data-live-activity="">
        <span className="dshx-live-shimmer dshx:min-w-0" data-live-paused={props.active ? undefined : ''} data-live-step="" style={phase}>
          {props.step}
          <span aria-hidden="true" className="dshx-live-shimmer-sweep">
            <span className="dshx-live-shimmer-copy" data-text={props.step} />
          </span>
        </span>
        {props.startedAt === undefined ? null : (
          <>
            <span aria-hidden="true" data-live-elapsed-separator="">
              ·
            </span>
            <LiveElapsed active={props.active} className="dshx:shrink-0" since={props.startedAt} />
          </>
        )}
      </span>
    )
  },
)

/** Keep a turn's object while its start and step are unchanged, so memoised rows skip the 3 s poll. */
const stabilize = (previous: ReadonlyMap<string, LiveTurnView>, next: ReadonlyMap<string, LiveTurnView>): ReadonlyMap<string, LiveTurnView> => {
  let changed = previous.size !== next.size
  const merged = new Map<string, LiveTurnView>()
  for (const [id, turn] of next) {
    const before = previous.get(id)
    // A drift under a second between two reads of the same start is clock noise, not a new turn.
    const same =
      before !== undefined &&
      before.step === turn.step &&
      (before.needsYou === true) === (turn.needsYou === true) &&
      (before.startedAt === turn.startedAt || Math.abs((before.startedAt ?? 0) - (turn.startedAt ?? 0)) < 1000)
    merged.set(id, same ? before : turn)
    if (!same) changed = true
  }
  return changed ? merged : previous
}

/**
 * The running turns of every listed thread: the Host's read (start and step) while one runs, else the moment this tab
 * saw the thread start running (an older Host without the read). Polls only while `runningIds` is not empty.
 */
export const useLiveTurns = (runningIds: readonly string[], listReady: boolean): ReadonlyMap<string, LiveTurnView> => {
  const api = useApi(threadSidebarLiveTurnsApi)
  const enabled = runningIds.length > 0
  const query = useQuery({
    queryKey: ['thread-sidebar', 'live-turns'],
    queryFn: async ({ signal }) => {
      const result = await api.list(undefined, { signal })
      return { ...result, readAt: Date.now() }
    },
    enabled,
    retry: false,
    staleTime: LIVE_TURNS_POLL_MS - 500,
    // An older Host has no read: stop asking. Any other failure retries at a slower pace.
    refetchInterval: current => (isApiOwnerMissing(current.state.error) ? false : current.state.error === null ? LIVE_TURNS_POLL_MS : 5 * LIVE_TURNS_POLL_MS),
    refetchIntervalInBackground: false,
  })
  // Where an older Host has no read, this tab remembers when it saw each thread start running. A thread already running
  // when the list first rendered has no known start (null), so it shows its step without a made-up clock.
  // The clock is read after the render that saw the change, so a new start shows from the next frame on.
  const [seenStarts, setSeenStarts] = useState<ReadonlyMap<string, number | null> | null>(null)
  useEffect(() => {
    // Until the session list has loaded, every running thread counts as already running.
    if (!listReady) return
    const now = Date.now()
    setSeenStarts(current => {
      const running = new Set(runningIds)
      const next = new Map<string, number | null>(current ?? runningIds.map(id => [id, null]))
      for (const id of next.keys()) if (!running.has(id)) next.delete(id)
      for (const id of runningIds) if (!next.has(id)) next.set(id, now)
      const same = current !== null && current.size === next.size && [...next].every(([id, start]) => current.get(id) === start)
      return same ? current : next
    })
  }, [runningIds, listReady])
  const previous = useRef<ReadonlyMap<string, LiveTurnView>>(EMPTY_TURNS)
  return useMemo(() => {
    const seen = seenStarts ?? new Map<string, number | null>()
    const data = query.data
    const skew = data === undefined ? 0 : data.readAt - data.now
    const host = new Map((data?.turns ?? []).map(turn => [turn.sessionId, turn]))
    const next = new Map<string, LiveTurnView>()
    for (const id of runningIds) {
      const turn = host.get(id)
      next.set(
        id,
        turn === undefined
          ? { startedAt: seen.get(id) ?? undefined, step: null }
          : { startedAt: turn.startedAt + skew, step: turn.step, ...(turn.needsYou === true && { needsYou: true }) },
      )
    }
    previous.current = stabilize(previous.current, next)
    return previous.current
  }, [runningIds, seenStarts, query.data])
}

export class LiveActivityModel {
  static readonly stabilize = stabilize
}
