// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

describe('toasts', () => {
  it('closes on its own after the default 5 s', () => {
    act(() => void stack.service.show({ title: 'Saved' }))
    expect(screen.getByRole('status').textContent).toContain('Saved')
    act(() => vi.advanceTimersByTime(4999))
    expect(screen.queryByRole('status')).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('honours a custom duration and keeps a sticky one', () => {
    act(() => {
      stack.service.show({ title: 'Short', duration: 100 })
      stack.service.show({ title: 'Sticky', duration: 0 })
    })
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Sticky'])
  })

  it('dismisses through the returned function and the close button', () => {
    let dismiss = (): void => {}
    act(() => {
      dismiss = stack.service.show({ title: 'First', duration: 0 })
      stack.service.show({ title: 'Second', duration: 0 })
    })
    act(() => dismiss())
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Second'])
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('runs the action, then dismisses', () => {
    const run = vi.fn()
    act(() => void stack.service.show({ title: 'Deleted', tone: 'danger', action: { label: 'Undo', run } }))
    const toast = screen.getByRole('alert')
    expect(toast.dataset.tone).toBe('danger')
    expect(toast.className).toContain('dshx:border-l-destructive')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(run).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
