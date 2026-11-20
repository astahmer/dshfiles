// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToastStack, type ToastStack } from './toast-stack.js'
import { ToastView } from './toast-view.js'

let stack: ToastStack

beforeEach(() => {
  vi.useFakeTimers()
  stack = createToastStack()
  render(<ToastView stack={stack} />)
})

afterEach(() => {
  stack.dispose()
  cleanup()
  vi.useRealTimers()
})

describe('toast queue', () => {
  it('shows one toast at a time and gives each queued one its full time', () => {
    act(() => {
      stack.service.show({ title: 'First' })
      stack.service.show({ title: 'Second' })
      stack.service.show({ title: 'Third', duration: 1000 })
    })
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['First'])
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Second'])
    act(() => vi.advanceTimersByTime(4999))
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Second'])
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Third'])
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('lets a timed toast through while a sticky one waits to be dismissed', () => {
    act(() => {
      stack.service.show({ title: 'Sticky', duration: 0 })
      stack.service.show({ title: 'Saved' })
    })
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Saved'])
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Sticky'])
  })

  it('shows a failure ahead of queued confirmations', () => {
    act(() => {
      stack.service.show({ title: 'Saved' })
      stack.service.show({ title: 'Copied' })
      stack.service.show({ title: 'Could not land', tone: 'danger' })
    })
    expect(screen.getByRole('alert').textContent).toBe('Could not land')
    expect(screen.queryByRole('status')).toBeNull()
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Saved'])
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Copied'])
  })
})
