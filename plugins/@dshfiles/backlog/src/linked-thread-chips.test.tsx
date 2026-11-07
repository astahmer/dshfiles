import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { LinkedThreadChips } from './linked-thread-chips.js'

const render = (input: { readonly sessionIds: readonly string[]; readonly titles: Readonly<Record<string, string>> }): string =>
  renderToStaticMarkup(<LinkedThreadChips sessionIds={input.sessionIds} threadTitle={sessionId => input.titles[sessionId]} openThread={() => undefined} />)

describe('linked thread chips', () => {
  it('names each chip with its thread, so two links never read as the same "Open thread"', () => {
    const html = render({
      sessionIds: ['session-9e185ebf', 'session-006f04e1'],
      titles: { 'session-9e185ebf': 'Opt-in thread subscription', 'session-006f04e1': 'Retry policy' },
    })

    expect(html.match(/aria-label="Open thread /gu)).toHaveLength(2)
    expect(html).toContain('aria-label="Open thread Opt-in thread subscription"')
    expect(html).toContain('aria-label="Open thread Retry policy"')
  })

  it('falls back to the short session id when the thread has no title', () => {
    expect(render({ sessionIds: ['session-9e185ebf'], titles: {} })).toContain('aria-label="Open thread Thread 9e185ebf"')
  })

  it('tells two threads with the same title apart', () => {
    const html = render({
      sessionIds: ['session-9e185ebf', 'session-006f04e1'],
      titles: { 'session-9e185ebf': 'Backlog polish', 'session-006f04e1': 'Backlog polish' },
    })

    expect(html).toContain('Open thread Backlog polish · 9e185ebf')
    expect(html).toContain('Open thread Backlog polish · 006f04e1')
  })
})
