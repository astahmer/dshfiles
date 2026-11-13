import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('is modal while shown: focus moves in, Tab stays inside, and focus returns to the trigger on close', () => {
    const Page = (props: { readonly shown: boolean }): JSX.Element => (
      <>
        <button type="button">Open panel</button>
        <PhoneSheet shown={props.shown} heading="Thread panel" onClose={() => {}}>
          <button type="button">Facet</button>
        </PhoneSheet>
      </>
    )
    const view = render(<Page shown={false} />)
    const trigger = screen.getByRole('button', { name: 'Open panel' })
    trigger.focus()
    view.rerender(<Page shown />)
    const sheet = screen.getByRole('dialog', { name: 'Thread panel' })
    expect(sheet.getAttribute('aria-modal')).toBe('true')
    expect(sheet.contains(document.activeElement)).toBe(true)
    const facet = screen.getByRole('button', { name: 'Facet' })
    facet.focus()
    fireEvent.keyDown(facet, { key: 'Tab' })
    expect(sheet.contains(document.activeElement)).toBe(true)
    view.rerender(<Page shown={false} />)
    expect(document.activeElement).toBe(trigger)
  })

  it('follows a header drag down, closes on a long pull and springs back from one that returns', () => {
    // jsdom has neither PointerEvent nor pointer capture; browsers do.
    HTMLElement.prototype.setPointerCapture ??= () => {}
    if (typeof window.PointerEvent !== 'function')
      Object.defineProperty(window, 'PointerEvent', {
        configurable: true,
        value: class extends MouseEvent {
          readonly pointerId: number
          readonly isPrimary: boolean
          constructor(type: string, init: PointerEventInit = {}) {
            super(type, init)
            this.pointerId = init.pointerId ?? 0
            this.isPrimary = init.isPrimary ?? false
          }
        },
      })
    const onClose = vi.fn()
    const { container } = render(
      <PhoneSheet shown heading="Thread panel" onClose={onClose}>
        <p>Body</p>
      </PhoneSheet>,
    )
    const sheet = container.ownerDocument.querySelector<HTMLElement>('[data-phone-sheet]')
    const handle = container.ownerDocument.querySelector<HTMLElement>('[data-phone-sheet-handle]')
    if (sheet === null || handle === null) throw new Error('sheet not rendered')
    expect(handle.style.touchAction).toBe('none')
    // jsdom lays nothing out: give the sheet a phone sheet's height, so a 200px pull is past 30% of it.
    sheet.getBoundingClientRect = () => new DOMRect(0, 0, 390, 600)
    const pointer = { pointerId: 1, isPrimary: true, button: 0 }
    fireEvent.pointerDown(handle, { ...pointer, clientY: 100 })
    fireEvent.pointerMove(handle, { ...pointer, clientY: 110 })
    expect(sheet.style.transform).toBe('translateY(10px)')
    fireEvent.pointerMove(handle, { ...pointer, clientY: 60 })
    expect(sheet.style.transform).toBe('')
    fireEvent.pointerUp(handle, { ...pointer, clientY: 60 })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(handle, { ...pointer, clientY: 100 })
    fireEvent.pointerMove(handle, { ...pointer, clientY: 300 })
    fireEvent.pointerUp(handle, { ...pointer, clientY: 300 })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(sheet.style.transform).toBe('')
    // The header's Close keeps its tap: pressing it starts no drag.
    fireEvent.pointerDown(screen.getAllByRole('button', { name: 'Close Thread panel' })[1] ?? handle, { ...pointer, clientY: 100 })
    fireEvent.pointerMove(handle, { ...pointer, clientY: 300 })
    expect(sheet.style.transform).toBe('')
  })

  it('is one history entry while shown: the browser Back closes it, and closing it consumes the entry', async () => {
    // Earlier sheets in this file left their entry tagged; start from an untagged one.
    window.history.replaceState(null, '', '/')
    const onClose = vi.fn()
    const start = window.history.length
    const view = render(
      <PhoneSheet shown heading="Thread panel" onClose={onClose}>
        <p>Body</p>
      </PhoneSheet>,
    )
    expect(window.history.length).toBe(start + 1)
    window.history.back()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    view.rerender(
      <PhoneSheet shown={false} heading="Thread panel" onClose={onClose}>
        <p>Body</p>
      </PhoneSheet>,
    )
    view.rerender(
      <PhoneSheet shown heading="Thread panel" onClose={onClose}>
        <p>Body</p>
      </PhoneSheet>,
    )
    // Closed from its own control: the entry it pushed is consumed, so the next Back leaves the screen below.
    view.rerender(
      <PhoneSheet shown={false} heading="Thread panel" onClose={onClose}>
        <p>Body</p>
      </PhoneSheet>,
    )
    await waitFor(() => expect(window.history.state?.dshfilesPhoneHistory?.depths?.dshfilesPhoneSheet ?? 0).toBe(0))
    expect(onClose).toHaveBeenCalledTimes(1)
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
      storage: () => ({
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => void values.set(key, value),
        removeItem: key => void values.delete(key),
      }),
    })
    visibility.set(true)
    let phone = true
    const actions = phoneAwareDockActions(createDockPaneActions(visibility, { panels: () => [], close: () => {} }), () => phone)
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
