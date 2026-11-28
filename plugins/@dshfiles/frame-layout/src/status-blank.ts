import { useCallback, useRef } from 'react'

/** Anything an item can draw without text: an icon, an image, a meter. */
const GRAPHIC = 'svg, img, canvas, meter, progress, [role="img"], [role="meter"], [role="progressbar"]'

/**
 * Status items that draw nothing (round five C6, council round 4). An item whose component renders an empty string
 * leaves a zero-length text node, which `:empty` does not match, so the item kept its padding and the hairline before
 * it: the strip ended in a stray divider. The strip marks such an item `data-status-blank` while it stays blank.
 */
export const StatusBlank = {
  /**
   * @param element - the item's seat in the strip.
   * @returns whether it shows no text and no graphic.
   */
  is(element: Element): boolean {
    return (element.textContent ?? '').trim() === '' && element.querySelector(GRAPHIC) === null
  },
  /**
   * Keep `data-status-blank` on an item while it draws nothing; items render on their own schedule.
   * @param element - the item's seat.
   * @returns stops watching.
   */
  watch(element: HTMLElement): () => void {
    const mark = (): void => {
      element.toggleAttribute('data-status-blank', StatusBlank.is(element))
    }
    const observer = new MutationObserver(mark)
    observer.observe(element, { subtree: true, childList: true, characterData: true })
    mark()
    return () => observer.disconnect()
  },
}

/** A ref for an item's seat that keeps its `data-status-blank` mark current. */
export function useStatusBlank(): (element: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null)
  return useCallback((element: HTMLElement | null) => {
    stop.current?.()
    stop.current = element === null ? null : StatusBlank.watch(element)
  }, [])
}
