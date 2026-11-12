import { useEffect, useRef, useState } from 'react'

const MINUTE_MS = 60_000

/**
 * How long a quota surface must wait before its next redraw. Compact chrome shows minutes and reset countdowns, so it
 * only needs the next minute boundary or the soonest reset, whichever comes first; a second-resolution readout asks
 * for `precision: 'second'` explicitly.
 */
export const nextQuotaTickDelayMs = (input: {
  readonly now: number
  readonly resetsAt: readonly (number | null)[]
  readonly precision?: 'minute' | 'second' | undefined
}): number => {
  if (input.precision === 'second') return 1_000
  const toMinuteBoundary = MINUTE_MS - (input.now % MINUTE_MS)
  const upcoming = input.resetsAt.flatMap(reset => (reset === null || !Number.isFinite(reset) || reset <= input.now ? [] : [reset - input.now]))
  const toSoonestReset = upcoming.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...upcoming)
  return Math.max(1, Math.min(toMinuteBoundary, toSoonestReset))
}

/**
 * The clock a quota surface renders with. It wakes on the schedule {@link nextQuotaTickDelayMs} computes, pauses in a
 * hidden tab and catches up on visibility or focus, so a closed compact strip stops ticking every second while a
 * reset crossing is still shown on time.
 */
export const useQuotaClock = (input: {
  readonly resetsAt: readonly (number | null)[]
  readonly precision?: 'minute' | 'second' | undefined
  /** Pause while this element is off screen (b:jaz6: the status strip's reset times); omitted, only a hidden tab pauses. */
  readonly element?: Element | null | undefined
}): number => {
  const [now, setNow] = useState(Date.now)
  const resets = useRef(input.resetsAt)
  resets.current = input.resetsAt
  const scheduleKey = input.resetsAt.map(reset => (reset === null ? '' : String(reset))).join(',')
  const element = input.element ?? null

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let onScreen = true
    const schedule = (): void => {
      clearTimeout(timer)
      const at = Date.now()
      setNow(at)
      timer = setTimeout(
        schedule,
        nextQuotaTickDelayMs({ now: at, resetsAt: resets.current, ...(input.precision !== undefined && { precision: input.precision }) }),
      )
    }
    const sync = (): void => {
      clearTimeout(timer)
      timer = undefined
      if (document.hidden || !onScreen) return
      schedule()
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    const visibility =
      element === null || typeof IntersectionObserver !== 'function'
        ? null
        : new IntersectionObserver(entries => {
            const visible = entries.at(-1)?.isIntersecting ?? true
            if (visible === onScreen) return
            onScreen = visible
            sync()
          })
    if (element !== null) visibility?.observe(element)
    return () => {
      clearTimeout(timer)
      visibility?.disconnect()
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [input.precision, scheduleKey, element])

  return now
}
