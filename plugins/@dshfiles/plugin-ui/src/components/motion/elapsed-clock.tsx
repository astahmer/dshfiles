import * as React from 'react'
import { everyFrame } from '../../motion/index.js'
import { formatElapsed } from '../../lib/format-duration.js'
import { cn } from '../../lib/utils.js'

/** Seconds in the kit's elapsed grammar (`12s`, `2m 05s`, `1h 04m`), the clock's default format. */
const elapsedSeconds = (seconds: number): string => formatElapsed(seconds * 1000)

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
export function ElapsedClock({ startedAt, endedAt, running = true, format = elapsedSeconds, className, ...props }: ElapsedClockProps) {
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
