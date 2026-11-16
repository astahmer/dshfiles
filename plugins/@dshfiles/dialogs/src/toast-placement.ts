import { useEffect, useState } from 'react'

/** Distance kept from the viewport edge, and from a composer the toast sits above. */
const MARGIN_PX = 16
const COMPOSER_GAP_PX = 8
/** The toast's width (`w-80`) and the tallest it gets with a description and an action. */
const TOAST_WIDTH_PX = 320
const TOAST_MAX_HEIGHT_PX = 140
/** The composer card of a conversation on screen, as its owner marks it; absent without that composer. */
const COMPOSER_SELECTOR = '[data-composer-card]'

interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export class ToastPlacement {
  /**
   * How far from the bottom edge the toast sits: the corner margin, or just above a composer whose model picker and
   * send button the corner would cover. A composer left of the toast, above the corner or hidden changes nothing.
   */
  static bottom(viewport: { readonly width: number; readonly height: number }, composers: readonly Box[]): number {
    const column = viewport.width - MARGIN_PX - TOAST_WIDTH_PX
    const corner = viewport.height - MARGIN_PX - TOAST_MAX_HEIGHT_PX
    const covered = composers.filter(box => box.width > 0 && box.height > 0 && box.right > column && box.bottom > corner && box.top < viewport.height)
    if (covered.length === 0) return MARGIN_PX
    return Math.max(MARGIN_PX, viewport.height - Math.min(...covered.map(box => box.top)) + COMPOSER_GAP_PX)
  }

  static measure(): number {
    // Conversations that are mounted but not on screen keep a laid-out, hidden composer: only a visible one counts.
    const composers = Array.from(document.querySelectorAll(COMPOSER_SELECTOR))
      .filter(element => element.checkVisibility?.({ visibilityProperty: true }) !== false)
      .map(element => element.getBoundingClientRect())
    return ToastPlacement.bottom({ width: window.innerWidth, height: window.innerHeight }, composers)
  }
}

/** The toast's bottom offset while one shows, re-measured when the window or a composer resizes. */
export const useToastBottom = (showing: boolean): number => {
  const [bottom, setBottom] = useState(MARGIN_PX)
  useEffect(() => {
    if (!showing) return
    const measure = (): void => setBottom(ToastPlacement.measure())
    measure()
    window.addEventListener('resize', measure)
    // A composer grows as the user types; ResizeObserver is absent in some embedders and tests.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    for (const element of Array.from(document.querySelectorAll(COMPOSER_SELECTOR))) observer?.observe(element)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [showing])
  return bottom
}
