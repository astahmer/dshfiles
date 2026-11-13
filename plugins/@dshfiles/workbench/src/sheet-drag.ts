import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/** A release past this share of the sheet's height closes it. */
export const SHEET_DRAG_CLOSE_RATIO = 0.3
/** A downward release faster than this closes the sheet however short the drag; an upward one this fast keeps it. */
export const SHEET_DRAG_FLICK_PX_PER_MS = 0.5
/** Only the last stretch of the drag decides the release velocity: an early fast pull followed by a pause is no flick. */
const VELOCITY_WINDOW_MS = 100
const SPRING_BACK = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)'

export interface SheetDragSample {
  readonly y: number
  readonly time: number
}

export const SheetDragModel = {
  /** The sheet follows the finger down, never above where it rests. */
  offset: (dy: number): number => Math.max(0, dy),
  /** Keep the samples still inside the velocity window of the newest one. */
  remember: (samples: readonly SheetDragSample[], next: SheetDragSample): readonly SheetDragSample[] => [
    ...samples.filter(sample => next.time - sample.time <= VELOCITY_WINDOW_MS),
    next,
  ],
  /** Release velocity in px/ms, positive downward, over the window; 0 without two samples apart in time. */
  velocity: (samples: readonly SheetDragSample[]): number => {
    const first = samples[0]
    const last = samples.at(-1)
    if (first === undefined || last === undefined || last.time <= first.time) return 0
    return (last.y - first.y) / (last.time - first.time)
  },
  closes: (input: { readonly offset: number; readonly height: number; readonly velocity: number }): boolean => {
    if (input.velocity > SHEET_DRAG_FLICK_PX_PER_MS) return true
    if (input.velocity < -SHEET_DRAG_FLICK_PX_PER_MS) return false
    return input.height > 0 && input.offset >= input.height * SHEET_DRAG_CLOSE_RATIO
  },
} as const

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Drag the phone sheet down by its header: the sheet follows the finger and a long enough pull or a downward flick
 * closes it; anything else springs back. The header's own buttons keep their taps.
 */
export const useSheetDrag = (input: { readonly sheet: RefObject<HTMLElement | null>; readonly onClose: () => void }) => {
  const drag = useRef<{ readonly pointerId: number; readonly startY: number; samples: readonly SheetDragSample[]; offset: number } | undefined>(undefined)
  const place = (offset: number, transition: string): void => {
    const sheet = input.sheet.current
    if (sheet === null) return
    sheet.style.transition = transition
    sheet.style.transform = offset > 0 ? `translateY(${offset}px)` : ''
  }
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!event.isPrimary || event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, a, input') !== null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, startY: event.clientY, samples: [{ y: event.clientY, time: event.timeStamp }], offset: 0 }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
    const current = drag.current
    if (current === undefined || current.pointerId !== event.pointerId) return
    current.samples = SheetDragModel.remember(current.samples, { y: event.clientY, time: event.timeStamp })
    current.offset = SheetDragModel.offset(event.clientY - current.startY)
    place(current.offset, 'none')
  }
  const finish = (event: ReactPointerEvent<HTMLElement>, released: boolean): void => {
    const current = drag.current
    if (current === undefined || current.pointerId !== event.pointerId) return
    drag.current = undefined
    const height = input.sheet.current?.getBoundingClientRect().height ?? 0
    const velocity = SheetDragModel.velocity(SheetDragModel.remember(current.samples, { y: event.clientY, time: event.timeStamp }))
    if (released && SheetDragModel.closes({ offset: current.offset, height, velocity })) {
      place(0, 'none')
      input.onClose()
      return
    }
    place(0, reducedMotion() ? 'none' : SPRING_BACK)
  }
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finish(event, true),
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finish(event, false),
  } as const
}
