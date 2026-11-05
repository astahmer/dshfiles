import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDockPaneActions } from './right-panel-mode.js'
import { PhoneSheet, PhoneSheetState, phoneAwareDockActions } from './phone-sheet.js'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'

afterEach(cleanup)

describe('PhoneSheet', () => {
  it('shows the thread panel as a dialog and puts it away from Close, the scrim and Escape', () => {
    const onClose = vi.fn()
    render(
      <PhoneSheet shown heading="Thread panel" onClose={onClose}>
        <p>Changes body</p>
      </PhoneSheet>,
    )
    expect(screen.getByRole('dialog', { name: 'Thread panel' })).toBeTruthy()
    expect(screen.getByText('Changes body')).toBeTruthy()
    const closers = screen.getAllByRole('button', { name: 'Close Thread panel' })
    expect(closers).toHaveLength(2)
    for (const closer of closers) fireEvent.click(closer)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('keeps the surface mounted but hidden, with no scrim, while closed', () => {
    const onClose = vi.fn()
    const { container } = render(
      <PhoneSheet shown={false} heading="Thread panel" onClose={onClose}>
        <p>Jobs body</p>
      </PhoneSheet>,
    )
    const sheet = container.querySelector<HTMLElement>('[data-phone-sheet]')
    expect(sheet?.hidden).toBe(true)
    expect(sheet?.style.display).toBe('none')
    expect(container.querySelector('[data-phone-sheet-scrim]')).toBeNull()
    expect(screen.getByText('Jobs body')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('phoneAwareDockActions', () => {
  it('drives the page-local sheet on a phone and leaves the remembered desktop pane alone', () => {
    const values = new Map<string, string>()
    const visibility = createStoredValue({
      key: 'test.right-pane-visible',
      schema: Schema.NullOr(Schema.Boolean),
      fallback: null,
      storage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value), removeItem: key => void values.delete(key) }),
    })
    visibility.set(true)
    let phone = true
    const actions = phoneAwareDockActions(createDockPaneActions(visibility), () => phone)
    PhoneSheetState.set(false)
    expect(actions.isOpen()).toBe(false)
    actions.toggle()
    expect(PhoneSheetState.get()).toBe(true)
    actions.close()
    expect(PhoneSheetState.get()).toBe(false)
    expect(visibility.get()).toBe(true)
    phone = false
    expect(actions.isOpen()).toBe(true)
    actions.close()
    expect(visibility.get()).toBe(false)
    expect(PhoneSheetState.get()).toBe(false)
  })
})
