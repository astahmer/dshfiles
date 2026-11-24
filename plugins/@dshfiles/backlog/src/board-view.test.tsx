// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import type { BacklogSummaryView } from './api.js'
import { cardClass, StateLine } from './board-view.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...(await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()),
  relativeTime: () => 'now',
}))

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

const render = (item: Partial<BacklogSummaryView>): HTMLElement => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  // SAFETY: StateLine reads only attention, status and lastActivityAt.
  const summary = { attention: 'none', lastActivityAt: Date.now(), ...item } as BacklogSummaryView
  act(() => root?.render(<StateLine item={summary} />))
  return host
}

test('a board card in progress draws the shared colourless working glyph, and done is muted', () => {
  const doing = render({ status: 'doing' })
  expect(doing.querySelector('[data-status-glyph="working"], [data-status="working"]')).not.toBeNull()
  expect(doing.innerHTML).not.toContain('text-info')
  act(() => root?.unmount())
  const done = render({ status: 'done' })
  expect(done.innerHTML).not.toContain('success')
})

test('a board card is bordered without a shadow, at the card radius', () => {
  expect(cardClass).not.toMatch(/shadow-(xs|sm|md|lg)/)
  expect(cardClass).toContain('dshx:rounded-lg')
})
