// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { BacklogSettingsSheet } from './backlog-settings-sheet.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

const Panel = (): JSX.Element => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" data-open-settings="" onClick={() => setOpen(true)}>
        Backlog settings
      </button>
      <section data-backlog-feed="">Open item b:1</section>
      <BacklogSettingsSheet open={open} onOpenChange={setOpen}>
        <h3>Jev triage</h3>
      </BacklogSettingsSheet>
    </>
  )
}

const dialog = (): HTMLElement | null => document.querySelector('[role="dialog"]')

test('opens settings over the backlog view and returns to it on close', () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<Panel />))
  act(() => document.querySelector<HTMLButtonElement>('[data-open-settings]')?.click())
  const sheet = dialog()
  expect(document.getElementById(sheet?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Backlog settings')
  expect(sheet?.textContent).toContain('Jev triage')
  expect(document.querySelector('[data-backlog-feed]')?.textContent).toBe('Open item b:1')
  const close = Array.from(sheet?.querySelectorAll('button') ?? []).find(button => button.textContent === 'Close')
  act(() => close?.click())
  expect(dialog()).toBeNull()
  expect(document.querySelector('[data-backlog-feed]')?.textContent).toBe('Open item b:1')
})
