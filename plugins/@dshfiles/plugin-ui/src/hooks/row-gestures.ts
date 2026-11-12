/**
 * Phone list rows: a sideways swipe commits one verb per side and a long press opens the row's sheet (visual refresh
 * T1.3, productivity pass T6.1). Touch only — a mouse or pen keeps drag-and-drop and right-click — and a swipe locks
 * only once the finger moved more sideways than down, so the list still scrolls. The pure model decides; the hook only
 * feeds it pointer deltas and one long-press timer.
 *
 * Owners map the sides to their own verbs: thread rows swipe left for Done and right for Pin, Inbox rows left for
 * Done and right for Snooze. A swipe never runs a verb that changes code or answers for the user (Land, Approve).
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'

export type RowSwipeSide = 'left' | 'right'
export type RowSwipeIntent = 'undecided' | 'horizontal' | 'vertical'

/** How far a row must travel before releasing commits its side; it also caps the visible travel past it. */
export const ROW_SWIPE_COMMIT_PX = 72
const ROW_SWIPE_MAX_PX = 96
/** Movement under this is a tap (or a long press), and decides nothing yet. */
const ROW_SWIPE_SLOP_PX = 10
/** A finger held this long without moving is a long press (iOS's own context-menu delay is about the same). */
export const ROW_LONG_PRESS_MS = 500

export const RowGestureModel = {
  /** Lock the gesture to one axis as soon as it leaves the tap slop; a vertical start never becomes a swipe. */
  intent: (current: RowSwipeIntent, dx: number, dy: number): RowSwipeIntent => {
    if (current !== 'undecided') return current
    if (Math.abs(dx) < ROW_SWIPE_SLOP_PX && Math.abs(dy) < ROW_SWIPE_SLOP_PX) return 'undecided'
    return Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
  },
  /** The row's visible offset: follows the finger, eased past the commit point and capped. */
  offset: (dx: number): number => {
    const sign = Math.sign(dx)
    const distance = Math.abs(dx)
    if (distance <= ROW_SWIPE_COMMIT_PX) return dx
    return sign * Math.min(ROW_SWIPE_MAX_PX, ROW_SWIPE_COMMIT_PX + (distance - ROW_SWIPE_COMMIT_PX) / 3)
  },
  /** The side a release at this offset commits, if any. */
  side: (dx: number): RowSwipeSide | undefined => {
    if (dx <= -ROW_SWIPE_COMMIT_PX) return 'left'
    if (dx >= ROW_SWIPE_COMMIT_PX) return 'right'
    return undefined
  },
  /** The side the uncovered edge names while dragging (shown under the row), committed or not. */
  revealed: (dx: number): RowSwipeSide | undefined => (dx < 0 ? 'left' : dx > 0 ? 'right' : undefined),
  /** A press still counts as a long press while the finger stays inside the tap slop. */
  stillPressing: (dx: number, dy: number): boolean => Math.abs(dx) < ROW_SWIPE_SLOP_PX && Math.abs(dy) < ROW_SWIPE_SLOP_PX,
} as const

interface Gesture {
  readonly pointerId: number
  readonly x: number
  readonly y: number
  intent: RowSwipeIntent
}

export interface RowGestures {
  readonly offset: number
  readonly handlers: {
    readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
    readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
    readonly onPointerCancel: () => void
    /** Swallows the click that ends a swipe or a long press, so neither also opens the row. */
    readonly onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void
  }
}

export interface RowGestureOptions {
  /** False on desktop pointers, while the row is renamed, or while its verbs cannot run. */
  readonly swipe: boolean
  readonly onSwipe: (side: RowSwipeSide) => void
  /** Opens the row's sheet; absent rows have no long press. Receives the row element, to anchor the sheet. */
  readonly onLongPress?: ((row: HTMLElement) => void) | undefined
}

/** Swipe and long-press tracking for one row. */
export const useRowGestures = (options: RowGestureOptions): RowGestures => {
  const gesture = useRef<Gesture | undefined>(undefined)
  const swallowClick = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [offset, setOffset] = useState(0)
  const latest = useRef(options)
  latest.current = options
  const clearTimer = (): void => {
    if (timer.current !== undefined) clearTimeout(timer.current)
    timer.current = undefined
  }
  useEffect(() => clearTimer, [])
  const reset = (): void => {
    clearTimer()
    gesture.current = undefined
    setOffset(0)
  }
  return {
    offset,
    handlers: {
      onPointerDown: event => {
        const { swipe, onLongPress } = latest.current
        if (event.pointerType !== 'touch' || !event.isPrimary || (!swipe && onLongPress === undefined)) return
        swallowClick.current = false
        gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, intent: 'undecided' }
        if (onLongPress === undefined) return
        // The row's own long press replaces any generic one (a context menu trigger's 700 ms touch timer).
        event.preventDefault()
        const row = event.currentTarget
        clearTimer()
        timer.current = setTimeout(() => {
          timer.current = undefined
          if (gesture.current === undefined || gesture.current.intent !== 'undecided') return
          gesture.current = undefined
          swallowClick.current = true
          latest.current.onLongPress?.(row)
        }, ROW_LONG_PRESS_MS)
      },
      onPointerMove: event => {
        const current = gesture.current
        if (current === undefined || current.pointerId !== event.pointerId) return
        const dx = event.clientX - current.x
        const dy = event.clientY - current.y
        if (!RowGestureModel.stillPressing(dx, dy)) clearTimer()
        current.intent = RowGestureModel.intent(current.intent, dx, dy)
        if (current.intent === 'vertical' || (current.intent === 'horizontal' && !latest.current.swipe)) {
          reset()
          return
        }
        if (current.intent === 'horizontal') setOffset(RowGestureModel.offset(dx))
      },
      onPointerUp: event => {
        const current = gesture.current
        if (current === undefined || current.pointerId !== event.pointerId) return
        const side = current.intent === 'horizontal' ? RowGestureModel.side(event.clientX - current.x) : undefined
        swallowClick.current = current.intent === 'horizontal'
        reset()
        if (side !== undefined) latest.current.onSwipe(side)
      },
      onPointerCancel: reset,
      onClickCapture: event => {
        if (!swallowClick.current) return
        swallowClick.current = false
        event.preventDefault()
        event.stopPropagation()
      },
    },
  }
}
