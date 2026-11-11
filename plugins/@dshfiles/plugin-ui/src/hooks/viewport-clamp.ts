import { useEffect, useState } from 'react'

const VIEWPORT_MARGIN = 8

/** How far a box must move along x to sit inside the viewport margins; a box wider than the viewport keeps its left edge in. */
export const viewportClampShift = (box: { readonly left: number; readonly width: number; readonly viewportWidth: number }): number => {
  const maxLeft = box.viewportWidth - VIEWPORT_MARGIN - box.width
  const clampedLeft = Math.max(VIEWPORT_MARGIN, Math.min(box.left, maxLeft))
  return clampedLeft - box.left
}

/**
 * Radix pins a submenu to the right or left of its trigger and only shifts it vertically, so on a phone, where neither
 * side has room, it opens off-screen. This slides the open content horizontally back inside the viewport (over its
 * parent menu) whenever Radix repositions it; a submenu that already fits gets no shift.
 */
export const useViewportClamp = (): ((element: HTMLElement | null) => void) => {
  const [element, setElement] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (element === null) return
    const positioner = element.parentElement ?? element
    const clamp = (): void => {
      const shift = viewportClampShift({
        left: positioner.getBoundingClientRect().left,
        width: element.offsetWidth,
        viewportWidth: document.documentElement.clientWidth,
      })
      element.style.translate = shift === 0 ? '' : `${shift}px 0`
    }
    clamp()
    const positionObserver = new MutationObserver(clamp)
    positionObserver.observe(positioner, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', clamp)
    return () => {
      positionObserver.disconnect()
      window.removeEventListener('resize', clamp)
      element.style.translate = ''
    }
  }, [element])
  return setElement
}
