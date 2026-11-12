// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROW_LONG_PRESS_MS, ROW_SWIPE_COMMIT_PX, RowGestureModel, useRowGestures } from './row-gestures.js'

const pointer = (type: string, x: number, y: number, extra: { readonly pointerType?: string } = {}) => {
  const row = document.createElement('div')
  return {
    type,
    pointerType: 'touch',
    isPrimary: true,
    pointerId: 1,
    clientX: x,
    clientY: y,
    currentTarget: row,
    preventDefault: vi.fn(),
    ...extra,
  } as never
}

describe('RowGestureModel', () => {
  it('locks to one axis once the finger leaves the slop', () => {
    expect(RowGestureModel.intent('undecided', 4, 3)).toBe('undecided')
    expect(RowGestureModel.intent('undecided', 20, 5)).toBe('horizontal')
    expect(RowGestureModel.intent('undecided', 6, 18)).toBe('vertical')
    expect(RowGestureModel.intent('vertical', 200, 0)).toBe('vertical')
  })
  it('commits a side only past the commit distance', () => {
    expect(RowGestureModel.side(-ROW_SWIPE_COMMIT_PX)).toBe('left')
    expect(RowGestureModel.side(ROW_SWIPE_COMMIT_PX)).toBe('right')
    expect(RowGestureModel.side(ROW_SWIPE_COMMIT_PX - 1)).toBeUndefined()
    expect(RowGestureModel.revealed(-1)).toBe('left')
    expect(RowGestureModel.revealed(0)).toBeUndefined()
    expect(RowGestureModel.offset(-1000)).toBe(-96)
  })
})

describe('useRowGestures', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('a held touch is a long press, and its click is swallowed', () => {
    const onLongPress = vi.fn()
    const onSwipe = vi.fn()
    const { result } = renderHook(() => useRowGestures({ swipe: true, onSwipe, onLongPress }))
    const down = pointer('pointerdown', 10, 10)
    act(() => result.current.handlers.onPointerDown(down))
    act(() => vi.advanceTimersByTime(ROW_LONG_PRESS_MS))
    expect(onLongPress).toHaveBeenCalledTimes(1)
    const click = { preventDefault: vi.fn(), stopPropagation: vi.fn() }
    act(() => result.current.handlers.onClickCapture(click as never))
    expect(click.preventDefault).toHaveBeenCalled()
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('moving the finger cancels the long press and a swipe commits its side', () => {
    const onLongPress = vi.fn()
    const onSwipe = vi.fn()
    const { result } = renderHook(() => useRowGestures({ swipe: true, onSwipe, onLongPress }))
    act(() => result.current.handlers.onPointerDown(pointer('pointerdown', 200, 10)))
    act(() => result.current.handlers.onPointerMove(pointer('pointermove', 150, 12)))
    act(() => vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2))
    act(() => result.current.handlers.onPointerUp(pointer('pointerup', 200 - ROW_SWIPE_COMMIT_PX - 4, 12)))
    expect(onLongPress).not.toHaveBeenCalled()
    expect(onSwipe).toHaveBeenCalledWith('left')
  })

  it('a quick tap neither swipes nor long-presses, and a mouse is ignored', () => {
    const onLongPress = vi.fn()
    const onSwipe = vi.fn()
    const { result } = renderHook(() => useRowGestures({ swipe: true, onSwipe, onLongPress }))
    act(() => result.current.handlers.onPointerDown(pointer('pointerdown', 10, 10)))
    act(() => result.current.handlers.onPointerUp(pointer('pointerup', 11, 10)))
    act(() => vi.advanceTimersByTime(ROW_LONG_PRESS_MS))
    act(() => result.current.handlers.onPointerDown(pointer('pointerdown', 10, 10, { pointerType: 'mouse' })))
    act(() => vi.advanceTimersByTime(ROW_LONG_PRESS_MS))
    expect(onLongPress).not.toHaveBeenCalled()
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('without swipe, a sideways drag only cancels the press', () => {
    const onLongPress = vi.fn()
    const onSwipe = vi.fn()
    const { result } = renderHook(() => useRowGestures({ swipe: false, onSwipe, onLongPress }))
    act(() => result.current.handlers.onPointerDown(pointer('pointerdown', 200, 10)))
    act(() => result.current.handlers.onPointerMove(pointer('pointermove', 100, 10)))
    act(() => result.current.handlers.onPointerUp(pointer('pointerup', 100, 10)))
    expect(result.current.offset).toBe(0)
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onLongPress).not.toHaveBeenCalled()
  })
})
