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
  it('replaces the toast on screen with a newer one after a 100 ms exit, instead of queueing behind it', () => {
    act(() => {
      stack.service.show({ title: 'First' })
      stack.service.show({ title: 'Second' })
    })
    // The first leaves (closed state, 100 ms exit) before the second shows, so two never stack.
    expect(screen.getAllByRole('status').map(toast => [toast.textContent, toast.dataset.state])).toEqual([['First', 'closed']])
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getAllByRole('status').map(toast => [toast.textContent, toast.dataset.state])).toEqual([['Second', 'open']])
    act(() => vi.advanceTimersByTime(4999))
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Second'])
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('never drops a failure: a newer confirmation waits behind it, and a newer failure queues', () => {
    act(() => {
      stack.service.show({ title: 'Could not land', tone: 'danger' })
      stack.service.show({ title: 'Could not save', tone: 'danger' })
      stack.service.show({ title: 'Saved' })
    })
    expect(screen.getByRole('alert').textContent).toBe('Could not land')
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getByRole('alert').textContent).toBe('Could not save')
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Saved'])
  })

  it('keeps a confirmation that carries an action: a newer toast waits behind it', () => {
    const run = vi.fn()
    act(() => {
      stack.service.show({ title: 'Archived', action: { label: 'Undo', run } })
      stack.service.show({ title: 'Saved' })
    })
    expect(screen.getAllByRole('status').map(toast => toast.querySelector('p')?.textContent)).toEqual(['Archived'])
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Saved'])
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

  it('shows a failure ahead of a queued confirmation', () => {
    act(() => {
      stack.service.show({ title: 'Saved' })
      stack.service.show({ title: 'Could not land', tone: 'danger' })
    })
    expect(screen.getByRole('alert').textContent).toBe('Could not land')
    expect(screen.queryByRole('status')).toBeNull()
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getAllByRole('status').map(toast => toast.textContent)).toEqual(['Saved'])
  })
})
