// @vitest-environment jsdom
import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  ReferenceChip: (props: { readonly label: string; readonly title: string }) =>
    createElement('span', { 'data-ref-chip': 'session', title: props.title }, props.label),
}))

import { SessionMentionChip, SessionReferenceLinks } from './session-reference-links.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

// `dsh-session:` + base64url(JSON.stringify(sessionId)).
const mention = (label: string, sessionId: string): string => `@[${label}](dsh-session:${btoa(JSON.stringify(sessionId)).replaceAll('=', '')})`

let root: Root | undefined
const mount = (node: JSX.Element | readonly unknown[]): HTMLElement => {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(node as JSX.Element))
  return container
}

describe('session reference links', () => {
  const opened: { readonly sessionId: string; readonly newTab: boolean }[] = []
  beforeEach(() => {
    opened.length = 0
    SessionReferenceLinks.connect({
      openThread: (sessionId, newTab) => {
        opened.push({ sessionId, newTab })
        return true
      },
      referencedSessions: () =>
        new Map([
          ['Mention target', 'session-target'],
          ['Second thread', 'session-second'],
        ]),
      sessionForLabel: label => (label === 'Other thread' ? 'session-other' : undefined),
    })
  })
  afterEach(() => {
    act(() => root?.unmount())
    document.body.innerHTML = ''
  })

  it('gives a sent session chip link semantics; Mod-click asks for a new tab', () => {
    // A sent chip carries `@label`; the thread comes from the conversation's recall events.
    const raw = '@Mention target'
    const container = mount(
      <SessionMentionChip
        interactive
        node={{ id: 'session', start: 0, end: raw.length, data: { label: 'Mention target' } }}
        raw={raw}
        sessionId="session-sender"
      />,
    )
    const link = container.querySelector('[data-dshfiles-session-link]')
    expect(link?.getAttribute('role')).toBe('link')
    expect(link?.querySelector('[data-ref-chip="session"]')?.textContent).toBe('Mention target')
    act(() => void link?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    act(() => void link?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, metaKey: true })))
    act(() => void link?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })))
    expect(opened).toEqual([
      { sessionId: 'session-target', newTab: false },
      { sessionId: 'session-target', newTab: true },
      { sessionId: 'session-target', newTab: false },
    ])
  })

  it('finds the thread of a chip whose renderer is not told its conversation', () => {
    const raw = '@Other thread'
    const container = mount(<SessionMentionChip interactive node={{ id: 'session', start: 0, end: raw.length, data: { label: 'Other thread' } }} raw={raw} />)
    act(() => void container.querySelector('[data-dshfiles-session-link]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })))
    expect(opened).toEqual([{ sessionId: 'session-other', newTab: false }])
  })

  it('keeps a queued or previewed chip inert', () => {
    const raw = mention('Mention target', 'session-target')
    const container = mount(
      <SessionMentionChip
        sessionId="session-sender"
        interactive={false}
        node={{ id: 'session', start: 0, end: raw.length, data: { label: 'Mention target' } }}
        raw={raw}
      />,
    )
    expect(container.querySelector('[role="link"]')).toBeNull()
  })

  it('makes the Referenced-session line one link that opens the only thread it names', () => {
    const context = { sessionId: 'session-sender', cwd: undefined, surface: 'summary', before: '' } as const
    const container = mount(InlineReferenceModel.renderText('Referenced session · Mention target', [SessionReferenceLinks.summary], context))
    const link = container.querySelector('[data-dshfiles-session-link]')
    expect(link?.getAttribute('role')).toBe('link')
    expect(link?.textContent).toBe('Referenced session · Mention target')
    act(() => void link?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })))
    expect(opened).toEqual([{ sessionId: 'session-target', newTab: false }])
    // Outside a conversation, or on prose, the provider claims nothing.
    expect(InlineReferenceModel.segment('Referenced session · Mention target', [SessionReferenceLinks.summary], { ...context, surface: 'prose' })).toEqual([
      { kind: 'text', text: 'Referenced session · Mention target' },
    ])
  })
})
