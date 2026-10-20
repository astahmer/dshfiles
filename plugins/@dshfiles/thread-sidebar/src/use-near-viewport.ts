import { useEffect, useState, type RefObject } from 'react'

/**
 * Whether an element is close enough to the viewport to mount its interactive
 * wrappers. A long thread list keeps every row in the DOM — layout height,
 * `data-thread-id` lookups and scroll-into-view must keep working — but the
 * per-row context menu, tooltips and hover actions are only worth mounting for
 * the rows a user can reach. Once mounted, a row stays mounted.
 *
 * Without an `IntersectionObserver` (a test environment, an old browser) every
 * row mounts, which is the previous behaviour.
 */
export const useNearViewport = (ref: RefObject<Element | null>, rootMargin = '600px'): boolean => {
  const [near, setNear] = useState(() => globalThis.IntersectionObserver === undefined)
  useEffect(() => {
    if (near) return
    const element = ref.current
    if (element === null) return
    if (globalThis.IntersectionObserver === undefined) {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        if (!entries.some(entry => entry.isIntersecting)) return
        setNear(true)
        observer.disconnect()
      },
      { rootMargin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [near, ref, rootMargin])
  return near
}
