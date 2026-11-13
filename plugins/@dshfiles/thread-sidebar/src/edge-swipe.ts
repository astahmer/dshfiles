/**
 * Phone edge swipes (visual refresh T5.3, plan phone rules "Gestures"). From the left edge, a touch that travels right
 * pops one level of the phone stack, like iOS. From the right edge (opt-in), a touch that travels left opens the thread
 * panel sheet. They never fight the content: only touches starting within the edge band count, a touch inside a thread
 * row (its own Done/Pin swipe), a dialog or menu, or a horizontally scrollable element is ignored, nothing starts while
 * a modal is open, and the gesture locks to an axis once it leaves the tap slop, so vertical scrolling still wins. In a
 * browser tab iOS claims the left edge for its own history swipe (the page then sees `touchcancel`); in a standalone
 * home-screen app, which has no system back swipe, this gesture is the back swipe. Android's back gesture claims a strip
 * at both edges, so the right band sits slightly inside the screen.
 */
import { useEffect, useRef } from 'react'

/** Touches that start this close to their edge (plus the safe area, and the right band's inset) may become a swipe. */
export const EDGE_SWIPE_BAND_PX = 24
/** The right band starts this far inside the screen, past the strip Android's own back gesture takes first. */
export const EDGE_SWIPE_RIGHT_INSET_PX = 12
/** A release this far away from the edge commits. */
export const EDGE_SWIPE_COMMIT_PX = 64
const EDGE_SWIPE_SLOP_PX = 10
/** The finger must travel this many times more sideways than down. */
const EDGE_SWIPE_AXIS_RATIO = 1.5

export type EdgeSwipeSide = 'left' | 'right'
export type EdgeSwipeIntent = 'undecided' | 'swipe' | 'other'

/** Travel away from the edge: rightward from the left edge, leftward from the right one. */
const inward = (side: EdgeSwipeSide, dx: number): number => (side === 'left' ? dx : -dx)

export const EdgeSwipeModel = {
  /** A touch can start a swipe only inside its edge band; `inset` is the safe area on that side. */
  starts: (input: { readonly side: EdgeSwipeSide; readonly x: number; readonly width: number; readonly inset?: number }): boolean => {
    const inset = input.inset ?? 0
    if (input.side === 'left') return input.x >= 0 && input.x <= EDGE_SWIPE_BAND_PX + inset
    const outer = input.width - EDGE_SWIPE_RIGHT_INSET_PX - inset
    return input.x <= outer && input.x >= outer - EDGE_SWIPE_BAND_PX
  },
  /** Lock to an axis once out of the slop: away from the edge and mostly sideways is a swipe; anything else is not. */
  intent: (input: { readonly side: EdgeSwipeSide; readonly current: EdgeSwipeIntent; readonly dx: number; readonly dy: number }): EdgeSwipeIntent => {
    if (input.current !== 'undecided') return input.current
    if (Math.abs(input.dx) < EDGE_SWIPE_SLOP_PX && Math.abs(input.dy) < EDGE_SWIPE_SLOP_PX) return 'undecided'
    const travel = inward(input.side, input.dx)
    return travel > 0 && travel > Math.abs(input.dy) * EDGE_SWIPE_AXIS_RATIO ? 'swipe' : 'other'
  },
  /** A swipe released far enough from its edge commits. */
  commits: (input: { readonly side: EdgeSwipeSide; readonly intent: EdgeSwipeIntent; readonly dx: number }): boolean =>
    input.intent === 'swipe' && inward(input.side, input.dx) >= EDGE_SWIPE_COMMIT_PX,
  /** An element that can scroll sideways owns a sideways drag started inside it, wherever it is scrolled to. */
  scrollsSideways: (box: { readonly scrollWidth: number; readonly clientWidth: number; readonly overflowX: string }): boolean =>
    box.scrollWidth > box.clientWidth && (box.overflowX === 'auto' || box.overflowX === 'scroll'),
} as const

/** A horizontally scrollable element between the target and the document owns sideways drags, even at its start. */
const insideHorizontalScroller = (target: Element | null): boolean => {
  for (let node = target; node !== null && node !== document.documentElement; node = node.parentElement) {
    if (!(node instanceof HTMLElement) || node.scrollWidth <= node.clientWidth) continue
    if (EdgeSwipeModel.scrollsSideways({ scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, overflowX: getComputedStyle(node).overflowX }))
      return true
  }
  return false
}

const ignored = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return true
  // A modal (the thread panel sheet, a dialog) owns the screen, scrim included, until it closes on its own controls.
  if (document.querySelector('[aria-modal="true"]:not([hidden])') !== null) return true
  // Thread rows carry their own Done/Pin swipe; sheets and dialogs above the stage close on their own controls.
  if (target.closest('article[data-thread-id], [role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]') !== null) return true
  return insideHorizontalScroller(target)
}

/** While `enabled`, a swipe in from the `side` edge calls `onSwipe` once per gesture. */
export const useEdgeSwipe = (input: { readonly side: EdgeSwipeSide; readonly enabled: boolean; readonly onSwipe: () => void }): void => {
  const onSwipeRef = useRef(input.onSwipe)
  onSwipeRef.current = input.onSwipe
  const { side, enabled } = input
  useEffect(() => {
    if (!enabled) return
    let gesture: { readonly id: number; readonly x: number; readonly y: number; intent: EdgeSwipeIntent } | undefined
    const start = (event: TouchEvent): void => {
      gesture = undefined
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      if (touch === undefined || !EdgeSwipeModel.starts({ side, x: touch.clientX, width: window.innerWidth }) || ignored(event.target)) return
      gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY, intent: 'undecided' }
    }
    const find = (list: TouchList, id: number): Touch | undefined => Array.from(list).find(touch => touch.identifier === id)
    const move = (event: TouchEvent): void => {
      if (gesture === undefined) return
      const touch = find(event.changedTouches, gesture.id)
      if (touch === undefined) return
      gesture.intent = EdgeSwipeModel.intent({ side, current: gesture.intent, dx: touch.clientX - gesture.x, dy: touch.clientY - gesture.y })
      if (gesture.intent === 'other') gesture = undefined
    }
    const end = (event: TouchEvent): void => {
      if (gesture === undefined) return
      const touch = find(event.changedTouches, gesture.id)
      // oxlint-disable-next-line antislop/no-passthrough-variable -- a snapshot: `gesture` is cleared on the next line.
      const current = gesture
      gesture = undefined
      if (touch !== undefined && EdgeSwipeModel.commits({ side, intent: current.intent, dx: touch.clientX - current.x })) onSwipeRef.current()
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
  }, [enabled, side])
}
