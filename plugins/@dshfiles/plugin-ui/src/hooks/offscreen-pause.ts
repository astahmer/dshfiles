import * as React from 'react'

/**
 * Pauses a looping animation while its element is scrolled out of view or inside a closed group, with one observer
 * shared by every caller, so a long list of spinners or skeletons costs no animation frames off screen (visual refresh
 * motion rule "no infinite animation off screen", T1.1 / T5.1).
 */
export class OffscreenPause {
  static #observer: IntersectionObserver | undefined
  static observe(element: Element): () => void {
    if (typeof IntersectionObserver === 'undefined') return () => undefined
    OffscreenPause.#observer ??= new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLElement || entry.target instanceof SVGElement)
          entry.target.style.animationPlayState = entry.isIntersecting ? 'running' : 'paused'
      }
    })
    OffscreenPause.#observer.observe(element)
    return () => OffscreenPause.#observer?.unobserve(element)
  }
}

/** Ref for an element whose own looping animation pauses off screen; compose it with a forwarded ref when needed. */
export const useOffscreenPause = <T extends Element>(): React.RefObject<T> => {
  const ref = React.useRef<T>(null)
  React.useEffect(() => {
    const element = ref.current
    return element === null ? undefined : OffscreenPause.observe(element)
  }, [])
  return ref
}
