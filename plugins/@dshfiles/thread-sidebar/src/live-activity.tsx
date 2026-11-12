import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApi } from '@dshfiles/dshx/client'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { memo, useEffect, useMemo, useRef } from 'react'
import { threadSidebarLiveTurnsApi } from './live-turns-api.js'

/**
 * The live activity line of a working thread (polish pass b:r4et): its current step with the working shimmer and a
 * ticking elapsed time ("Running pnpm test · 1m 12s", "Working · 1m 12s"). Built so 20 working rows cost nothing per
 * frame: one Host read every 3 s for all of them, one 1 s ticker for the page that writes each visible clock's text
 * directly (no React render), and a CSS shimmer phase-locked across rows that pauses off screen and under reduced motion.
 */

/** One running turn, on this browser's clock. */
export interface LiveTurnView {
  /** Browser clock, epoch ms; undefined when neither the Host nor this tab saw the turn start. */
  readonly startedAt: number | undefined
  readonly step: string | null
}

const LIVE_TURNS_POLL_MS = 3_000
const EMPTY_TURNS: ReadonlyMap<string, LiveTurnView> = new Map()

/** "12s", "1m 12s", "1h 04m": the elapsed time of a running turn. */
const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${String(total)}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(total % 60).padStart(2, '0')}s`
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, '0')}m`
}

type TickListener = (now: number) => void
const tickListeners = new Set<TickListener>()
let tickTimer: ReturnType<typeof setTimeout> | undefined

/** The page's one clock: aligned to whole seconds, running only while a visible clock listens and the tab is shown. */
const scheduleTick = (): void => {
  if (tickTimer !== undefined || tickListeners.size === 0) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  tickTimer = setTimeout(
    () => {
      tickTimer = undefined
      const now = Date.now()
      for (const listener of tickListeners) listener(now)
      scheduleTick()
    },
    1000 - (Date.now() % 1000),
  )
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (tickTimer !== undefined) clearTimeout(tickTimer)
      tickTimer = undefined
      return
    }
    const now = Date.now()
    for (const listener of tickListeners) listener(now)
    scheduleTick()
  })
}

const subscribeTick = (listener: TickListener): (() => void) => {
  tickListeners.add(listener)
  scheduleTick()
  return () => {
    tickListeners.delete(listener)
    if (tickListeners.size === 0 && tickTimer !== undefined) {
      clearTimeout(tickTimer)
      tickTimer = undefined
    }
  }
}

/** A running clock's text, written straight into its span by the shared ticker while `active` (on screen). */
export const LiveElapsed = memo((props: { readonly startedAt: number; readonly active: boolean; readonly className?: string }): JSX.Element => {
  const ref = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const write = (now: number): void => {
      const text = formatElapsed(now - props.startedAt)
      if (element.textContent !== text) element.textContent = text
    }
    write(Date.now())
    if (!props.active) return
    return subscribeTick(write)
  }, [props.active, props.startedAt])
  return <span ref={ref} className={cn('dshx:tabular-nums', props.className)} data-live-elapsed="" />
})

/** Every shimmer starts at the same phase of the page clock, so a list of working rows sweeps in step. */
const shimmerDelay = (): string => `-${String(Math.round((typeof performance === 'undefined' ? 0 : performance.now()) % 2200))}ms`

/**
 * The working step in the shimmer, then the elapsed time. `active` false (off screen) pauses both. Colourless: the
 * spinner glyph says Working; the shimmer only shows it is live.
 */
export const LiveActivityLine = memo(
  (props: { readonly step: string; readonly startedAt: number | undefined; readonly active: boolean; readonly className?: string }): JSX.Element => {
    const delay = useMemo(shimmerDelay, [])
    return (
      <span className={cn('dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1', props.className)} data-live-activity="">
        <span
          className="dshx-live-shimmer dshx:min-w-0 dshx:truncate"
          data-live-paused={props.active ? undefined : ''}
          data-live-step=""
          style={{ animationDelay: delay }}
        >
          {props.step}
        </span>
        {props.startedAt === undefined ? null : (
          <>
            <span aria-hidden="true" data-live-elapsed-separator="">
              ·
            </span>
            <LiveElapsed active={props.active} className="dshx:shrink-0" startedAt={props.startedAt} />
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
  const seenStarts = useRef<Map<string, number | null> | null>(null)
  const previous = useRef<ReadonlyMap<string, LiveTurnView>>(EMPTY_TURNS)
  return useMemo(() => {
    const now = Date.now()
    const running = new Set(runningIds)
    // Until the session list has loaded, every running thread counts as already running.
    if (seenStarts.current === null && listReady) seenStarts.current = new Map(runningIds.map(id => [id, null]))
    const seen = seenStarts.current ?? new Map<string, number | null>(runningIds.map(id => [id, null]))
    for (const id of seen.keys()) if (!running.has(id)) seen.delete(id)
    for (const id of runningIds) if (!seen.has(id)) seen.set(id, now)
    const data = query.data
    const skew = data === undefined ? 0 : data.readAt - data.now
    const host = new Map((data?.turns ?? []).map(turn => [turn.sessionId, turn]))
    const next = new Map<string, LiveTurnView>()
    for (const id of runningIds) {
      const turn = host.get(id)
      next.set(id, turn === undefined ? { startedAt: seen.get(id) ?? undefined, step: null } : { startedAt: turn.startedAt + skew, step: turn.step })
    }
    previous.current = stabilize(previous.current, next)
    return previous.current
  }, [runningIds, listReady, query.data])
}

export class LiveActivityModel {
  static readonly formatElapsed = formatElapsed
  static readonly stabilize = stabilize
}
