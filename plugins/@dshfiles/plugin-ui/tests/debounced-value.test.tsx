import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from '../src/hooks/debounced-value.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebouncedValue', () => {
  it('publishes only the last value after the delay', () => {
    const { result, rerender } = renderHook((props: { value: string }) => useDebouncedValue({ value: props.value, delayMs: 200 }), {
      initialProps: { value: '' },
    })
    rerender({ value: 'a' })
    act(() => vi.advanceTimersByTime(100))
    rerender({ value: 'ab' })
    act(() => vi.advanceTimersByTime(150))
    expect(result.current).toBe('')
    act(() => vi.advanceTimersByTime(50))
    expect(result.current).toBe('ab')
  })
})
