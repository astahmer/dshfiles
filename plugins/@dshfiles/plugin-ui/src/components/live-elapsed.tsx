import * as React from 'react'
import { cn } from '../lib/utils.js'

/**
 * The page's one second clock for elapsed times (transcript run folds, b:7rv2). Every visible clock subscribes to the
 * same timer, aligned to whole seconds and stopped while the tab is hidden or nothing listens, and each clock writes its
 * own span's text directly, so twenty ticking rows cost one timer and no React render per second.
 */

type TickListener = (now: number) => void
const listeners = new Set<TickListener>()
let timer: ReturnType<typeof setTimeout> | undefined

const schedule = (): void => {
  if (timer !== undefined || listeners.size === 0) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  timer = setTimeout(
    () => {
      timer = undefined
      const now = Date.now()
      for (const listener of listeners) listener(now)
      schedule()
    },
    1000 - (Date.now() % 1000),
  )
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      return
    }
    const now = Date.now()
    for (const listener of listeners) listener(now)
    schedule()
  })
}

/** Listen to the shared second tick; returns the unsubscribe. */
export const subscribeSecondTick = (listener: TickListener): (() => void) => {
  listeners.add(listener)
  schedule()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
}

/** "12s", "1m 12s", "1h 04m". */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${String(total)}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(total % 60).padStart(2, '0')}s`
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, '0')}m`
}

export interface LiveElapsedProps {
  /** Epoch ms the clock counts from. */
  readonly since: number
  /** False freezes the text (off screen, or the work settled). */
  readonly active: boolean
  /** Turns the elapsed text into the shown text, e.g. `ms => `longest ${ms}``. */
  readonly format?: (elapsed: string) => string
  readonly className?: string
}

/** An elapsed time ticking on the shared clock while `active`; the text is written straight into the span. */
export const LiveElapsed = React.memo(function LiveElapsed(props: LiveElapsedProps): React.JSX.Element {
  const ref = React.useRef<HTMLSpanElement | null>(null)
  const formatRef = React.useRef(props.format)
  formatRef.current = props.format
  React.useEffect(() => {
    const element = ref.current
    if (element === null) return undefined
    const write = (now: number): void => {
      const elapsed = formatElapsed(now - props.since)
      const text = formatRef.current === undefined ? elapsed : formatRef.current(elapsed)
      if (element.textContent !== text) element.textContent = text
    }
    write(Date.now())
    if (!props.active) return undefined
    return subscribeSecondTick(write)
  }, [props.active, props.since])
  return <span ref={ref} className={cn('dshx:tabular-nums', props.className)} data-live-elapsed="" />
})
