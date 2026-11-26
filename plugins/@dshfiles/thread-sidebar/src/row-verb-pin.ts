import { type RefObject, useLayoutEffect, useState } from 'react'

/** The touch verb's height (28px) over the excerpt's 18px line: it starts 5px above the line to centre on it. */
const CENTRE_OFFSET = 5

/**
 * Where a touch row's verb starts so it centres on the first line of a two-line question (council round 12 B4), in px
 * from the top of the row's fill; undefined on a fine pointer or before the row is laid out. The excerpt's top depends on
 * how many lines the title takes, so it is measured, and measured again when the row resizes. CSS cannot place it: the
 * verb sits outside the row's main button, and WebKit draws no subgrid inside a button.
 */
export const usePinnedVerbTop = (excerpt: RefObject<HTMLElement | null>, enabled: boolean): number | undefined => {
  const [top, setTop] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const element = excerpt.current
    const fill = element?.closest<HTMLElement>('[data-row-wash]')
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    if (!enabled || !coarse || element === null || element === undefined || fill === null || fill === undefined) {
      setTop(undefined)
      return
    }
    const measure = (): void => setTop(Math.round(element.getBoundingClientRect().top - fill.getBoundingClientRect().top) - CENTRE_OFFSET)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(fill)
    return () => observer.disconnect()
  }, [enabled, excerpt])
  return top
}
