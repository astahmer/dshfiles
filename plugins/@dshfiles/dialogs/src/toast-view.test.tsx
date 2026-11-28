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
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(run).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('is a plain bordered card whose icon alone carries the tone: green for success, red for a failure', () => {
    const iconOf = (toast: HTMLElement): string => toast.querySelector('[data-toast-icon]')?.getAttribute('class') ?? ''
    act(() => void stack.service.show({ title: 'Draft saved', tone: 'success', duration: 0 }))
    const saved = screen.getByRole('status')
    expect(saved.className).not.toMatch(/border-l-/u)
    expect(saved.className).toContain('dshx:rounded-xl')
    expect(iconOf(saved)).toContain('dshx:text-success')
    // Green is the glyph only: the words stay ink.
    expect(saved.querySelector('p')?.className ?? '').not.toMatch(/text-success/u)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    for (const tone of ['info', 'warning'] as const) {
      act(() => void stack.service.show({ title: tone, tone, duration: 0 }))
      expect(iconOf(screen.getByRole('status'))).toContain('dshx:text-muted-foreground')
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    }

    act(() => void stack.service.show({ title: 'Could not save', tone: 'danger', duration: 0 }))
    const failed = screen.getByRole('alert')
    expect(failed.className).not.toMatch(/border-l-/u)
    expect(iconOf(failed)).toContain('dshx:text-destructive')
  })

  it('sits above a composer it would cover and returns to the corner without one', () => {
    const list = (): HTMLElement => screen.getByRole('list', { name: 'Notifications' })
    act(() => void stack.service.show({ title: 'Saved', duration: 0 }))
    expect(list().style.bottom).toBe('16px')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    const card = document.createElement('div')
    card.setAttribute('data-composer-card', 'true')
    card.getBoundingClientRect = () => new DOMRect(470, 660, 774, 88)
    document.body.append(card)
    // A conversation that is mounted but hidden keeps a composer higher up; it must not lift the toast.
    const hidden = document.createElement('div')
    hidden.setAttribute('data-composer-card', 'true')
    hidden.getBoundingClientRect = () => new DOMRect(470, 500, 774, 88)
    hidden.checkVisibility = () => false
    document.body.append(hidden)
    act(() => void stack.service.show({ title: 'Saved again', duration: 0 }))
    expect(list().style.bottom).toBe(`${window.innerHeight - 660 + 8}px`)
    card.remove()
    hidden.remove()
  })
})
