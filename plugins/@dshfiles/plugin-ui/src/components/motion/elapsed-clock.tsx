import * as React from 'react'
import { everyFrame } from '../../motion/index.js'
import { cn } from '../../lib/utils.js'

/** `m:ss` (or `h:mm:ss` past an hour), the clock format run cards use. */
export const formatClock = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** `12s`, `1m 04s`: compact step durations. */
export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds))
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}

export interface ElapsedClockProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Epoch milliseconds the run started. */
  readonly startedAt: number
  /** Epoch milliseconds it stopped; the clock freezes there. */
  readonly endedAt?: number | undefined
  /** Ticks while true; freezes at the last value when false (paused). */
  readonly running?: boolean
  readonly format?: (seconds: number) => string
}

/**
 * A live elapsed-time label driven by `everyFrame` (no setInterval, no re-render per frame: it writes its own text
 * only when the visible value changes). Screen readers get the value through `aria-live="off"` text.
 */
export function ElapsedClock({ startedAt, endedAt, running = true, format = formatClock, className, ...props }: ElapsedClockProps) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const compute = React.useCallback(() => format(((endedAt ?? Date.now()) - startedAt) / 1000), [startedAt, endedAt, format])
  React.useEffect(() => {
    const element = ref.current
    if (element == null) return
    element.textContent = compute()
    if (!running || endedAt !== undefined) return
    let last = element.textContent
    return everyFrame(() => {
      const next = compute()
      if (next !== last) {
        element.textContent = next
        last = next
      }
    })
  }, [compute, running, endedAt])
  return <span ref={ref} className={cn('dshx:tabular-nums', className)} {...props} />
}
