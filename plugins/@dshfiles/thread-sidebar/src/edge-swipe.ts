/**
 * Phone back swipe (visual refresh T5.3, plan phone rules "Gestures"): a touch that starts on the left screen edge and
 * travels right pops one level of the phone stack, like iOS. It never fights the content: only touches starting within
 * the edge band count, a touch inside a thread row (its own Done/Pin swipe) or inside a horizontal scroller that is
 * already scrolled is ignored, and the gesture locks to an axis once it leaves the tap slop, so vertical scrolling
 * still wins. In a browser tab iOS claims the edge for its own history swipe (the page then sees `touchcancel`); in a
 * standalone home-screen app, which has no system back swipe, this gesture is the back swipe.
 */
import { useEffect, useRef } from 'react'

/** Touches that start this close to the left edge (plus the left safe area) may become a back swipe. */
export const EDGE_SWIPE_BAND_PX = 24
/** A release this far to the right commits Back. */
export const EDGE_SWIPE_COMMIT_PX = 64
const EDGE_SWIPE_SLOP_PX = 10

export type EdgeSwipeIntent = 'undecided' | 'back' | 'other'

export const EdgeSwipeModel = {
  /** A touch can start a back swipe only inside the edge band. */
  starts: (x: number, insetLeft = 0): boolean => x >= 0 && x <= EDGE_SWIPE_BAND_PX + insetLeft,
  /** Lock to an axis once out of the slop: rightward and more sideways than down is a back swipe; anything else is not. */
  intent: (current: EdgeSwipeIntent, dx: number, dy: number): EdgeSwipeIntent => {
    if (current !== 'undecided') return current
    if (Math.abs(dx) < EDGE_SWIPE_SLOP_PX && Math.abs(dy) < EDGE_SWIPE_SLOP_PX) return 'undecided'
    return dx > 0 && dx > Math.abs(dy) * 1.5 ? 'back' : 'other'
  },
  /** A back swipe released far enough right commits. */
  commits: (intent: EdgeSwipeIntent, dx: number): boolean => intent === 'back' && dx >= EDGE_SWIPE_COMMIT_PX,
} as const

/** A horizontal scroller between the target and the document that is scrolled past its start owns the drag. */
const insideScrolledScroller = (target: Element | null): boolean => {
  for (let node = target; node !== null && node !== document.documentElement; node = node.parentElement) {
    if (!(node instanceof HTMLElement)) continue
    if (node.scrollWidth <= node.clientWidth || node.scrollLeft <= 0) continue
    const overflow = getComputedStyle(node).overflowX
    if (overflow === 'auto' || overflow === 'scroll') return true
  }
  return false
}

const ignored = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return true
  // Thread rows carry their own Done/Pin swipe; sheets and dialogs above the stage close on their own controls.
  if (target.closest('article[data-thread-id], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]') !== null) return true
  return insideScrolledScroller(target)
}

/** While `enabled` (a phone stack level with a Back), a left-edge swipe calls `back` once per gesture. */
export const useEdgeSwipeBack = (enabled: boolean, back: () => void): void => {
  const backRef = useRef(back)
  backRef.current = back
  useEffect(() => {
    if (!enabled) return
    let gesture: { readonly id: number; readonly x: number; readonly y: number; intent: EdgeSwipeIntent } | undefined
    const start = (event: TouchEvent): void => {
      gesture = undefined
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      if (touch === undefined || !EdgeSwipeModel.starts(touch.clientX) || ignored(event.target)) return
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, intent: 'undecided' }
    }
    const find = (list: TouchList, id: number): Touch | undefined => Array.from(list).find(touch => touch.identifier === id)
    const move = (event: TouchEvent): void => {
      if (gesture === undefined) return
      const touch = find(event.changedTouches, gesture.id)
      if (touch === undefined) return
      gesture.intent = EdgeSwipeModel.intent(gesture.intent, touch.clientX - gesture.x, touch.clientY - gesture.y)
      if (gesture.intent === 'other') gesture = undefined
    }
    const end = (event: TouchEvent): void => {
      if (gesture === undefined) return
      const touch = find(event.changedTouches, gesture.id)
      const current = gesture
      gesture = undefined
      if (touch !== undefined && EdgeSwipeModel.commits(current.intent, touch.clientX - current.x)) backRef.current()
    }
    const cancel = (): void => {
      gesture = undefined
    }
    document.addEventListener('touchstart', start, { passive: true })
    document.addEventListener('touchmove', move, { passive: true })
    document.addEventListener('touchend', end, { passive: true })
    document.addEventListener('touchcancel', cancel, { passive: true })
    return () => {
      document.removeEventListener('touchstart', start)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', cancel)
    }
  }, [enabled])
}
