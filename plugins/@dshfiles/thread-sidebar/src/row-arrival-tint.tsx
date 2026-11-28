import type { WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

/** The states worth a second look when a row enters them on screen (DESIGN.md › Motion). */
const ARRIVALS = ['needs-you', 'failed', 'ready'] as const
type Arrival = (typeof ARRIVALS)[number]

/** One tint run; the key restarts it when the row changes again before the last one ended. */
export interface RowTint {
  readonly status: Arrival
  readonly key: number
}

/** The row's current tint run, if any, and how its fade reports that it ended. */
export interface RowArrivalTintState {
  readonly tint: RowTint | undefined
  readonly end: () => void
}

const tintClass = {
  'needs-you': 'dshx:bg-status-needs-you/12',
  failed: 'dshx:bg-status-failed/12',
  ready: 'dshx:bg-status-ready/12',
} as const satisfies Record<Arrival, string>

const isArrival = (status: WorkStatus): status is Arrival => ARRIVALS.some(arrival => arrival === status)

const arrives = (before: WorkStatus | undefined, after: WorkStatus | undefined): after is Arrival =>
  before !== undefined && after !== undefined && before !== after && isArrival(after)

const reducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Status rows grouped by state change group when their state changes, so the list unmounts the row in its old group and
 * mounts one in the new group in the same commit. A leaving row records its status here; a row of the same thread that
 * mounts in that commit reads it as its previous status. The microtask drops what nobody picked up, so a row that comes
 * back later (scrolled into view, a group reopened) starts fresh and never replays a change.
 */
const departed = new Map<string, WorkStatus>()
let clearScheduled = false
const recordDeparture = (sessionId: string, status: WorkStatus): void => {
  departed.set(sessionId, status)
  if (clearScheduled) return
  clearScheduled = true
  queueMicrotask(() => {
    clearScheduled = false
    departed.clear()
  })
}

const takeDeparture = (sessionId: string): WorkStatus | undefined => {
  const status = departed.get(sessionId)
  departed.delete(sessionId)
  return status
}

/**
 * The tint a row shows after its status became Needs you, Failed or Ready while it was on screen (a change in place, or
 * a move between status groups). Never on first mount, a scroll back into view or a virtualised remount, and never
 * under reduced motion.
 */
const useRowArrivalTint = (sessionId: string, status: WorkStatus | undefined): RowArrivalTintState => {
  const [tint, setTint] = useState<RowTint | undefined>(undefined)
  const seen = useRef(status)
  const start = useCallback((next: Arrival) => {
    if (reducedMotion()) return
    setTint(current => ({ status: next, key: (current?.key ?? 0) + 1 }))
  }, [])
  // Layout effects, so the tint is in place before the browser paints the changed row.
  useLayoutEffect(() => {
    const before = seen.current
    seen.current = status
    if (arrives(before, status)) start(status)
  }, [start, status])
  useLayoutEffect(() => {
    const before = takeDeparture(sessionId)
    const now = seen.current
    if (arrives(before, now)) start(now)
    return () => {
      if (seen.current !== undefined) recordDeparture(sessionId, seen.current)
    }
  }, [sessionId, start])
  const end = useCallback(() => setTint(undefined), [])
  return { tint, end }
}

/** Reads a `--dshx-duration-*` token in milliseconds, so the tint follows the kit's motion scale. */
const durationOf = (element: Element, token: string, fallback: number): number => {
  const raw = getComputedStyle(element).getPropertyValue(token).trim()
  const value = Number.parseFloat(raw)
  if (!Number.isFinite(value)) return fallback
  return raw.endsWith('ms') ? value : raw.endsWith('s') ? value * 1000 : fallback
}

/**
 * The row's arrival tint: the new state's colour at 12% behind the row, held for `--dshx-duration-hold` (1.2s), then
 * faded out over `--dshx-duration-sheet` (280ms). It animates opacity only and takes no pointer events or layout.
 */
const RowArrivalTint = (props: { readonly tint: RowTint; readonly onEnd: () => void }): JSX.Element => {
  const element = useRef<HTMLSpanElement | null>(null)
  const onEnd = useRef(props.onEnd)
  onEnd.current = props.onEnd
  // One run per mount: the row keys this component by the tint run, so a second change restarts it from full.
  useLayoutEffect(() => {
    const target = element.current
    if (target === null) return
    // Without the Web Animations API the row stays plain rather than keeping a tint it cannot fade.
    if (typeof target.animate !== 'function') {
      onEnd.current()
      return
    }
    const hold = durationOf(target, '--dshx-duration-hold', 1200)
    const fade = durationOf(target, '--dshx-duration-sheet', 280)
    const total = hold + fade
    const animation = target.animate([{ opacity: 1 }, { opacity: 1, offset: hold / total, easing: 'ease-out' }, { opacity: 0 }], {
      duration: total,
      fill: 'forwards',
    })
    animation.onfinish = () => onEnd.current()
    return () => animation.cancel()
  }, [])
  return (
    <span
      ref={element}
      aria-hidden="true"
      data-row-tint={props.tint.status}
      className={cn('dshx:pointer-events-none dshx:absolute dshx:inset-0 dshx:rounded-md', tintClass[props.tint.status])}
    />
  )
}

export class RowArrivalTintModel {
  static readonly arrives = arrives
  static readonly useTint = useRowArrivalTint
  static readonly Tint = RowArrivalTint
}
