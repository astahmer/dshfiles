// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useCopyFeedback } from './copy-feedback.js'

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  vi.useFakeTimers()
  writeText.mockReset()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('reports copied after a successful write and clears it after 1.5 s', async () => {
  writeText.mockResolvedValue(undefined)
  const { result } = renderHook(() => useCopyFeedback())
  await act(async () => {
    expect(await result.current.copy('session-1')).toBe(true)
  })
  expect(writeText).toHaveBeenCalledWith('session-1')
  expect(result.current.copied).toBe(true)
  act(() => vi.advanceTimersByTime(1_499))
  expect(result.current.copied).toBe(true)
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.copied).toBe(false)
})

test('stays uncopied when the clipboard refuses the write', async () => {
  writeText.mockRejectedValue(new Error('denied'))
  const { result } = renderHook(() => useCopyFeedback())
  await act(async () => {
    expect(await result.current.copy('session-1')).toBe(false)
  })
  expect(result.current.copied).toBe(false)
})
