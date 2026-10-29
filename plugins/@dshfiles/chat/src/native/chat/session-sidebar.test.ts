import type { ISidebarRight } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { expect, it } from 'vitest'
import { sessionSidebar } from './session-sidebar.ts'

// SAFETY: a stable fixture identity; the helper only forwards it.
const sessionId = 'chat-session' as SessionId

const recordingSidebar = (calls: unknown[][]): ISidebarRight => ({
  mounted: { getSnapshot: () => undefined, subscribe: () => () => {} },
  openResource: (...args) => {
    calls.push(['openResource', ...args])
  },
  openTab: (...args) => {
    calls.push(['openTab', ...args])
  },
  close: () => {},
  active: () => undefined,
  isExpanded: () => false,
  toggleExpanded: () => {},
  focus: () => {},
  split: () => undefined,
  float: () => {},
  dock: () => {},
})

it('opens links for the conversation Session when the owned Sidebar supports it', () => {
  const calls: unknown[][] = []
  const sidebar = {
    ...recordingSidebar(calls),
    openResourceFor: (...args: unknown[]) => {
      calls.push(['openResourceFor', ...args])
    },
    openTabFor: (...args: unknown[]) => {
      calls.push(['openTabFor', ...args])
    },
  }
  const opens = sessionSidebar(sidebar, sessionId)
  opens.openResource('dsh-resource://file/session/chat-session/a.md', { params: { line: 2 } })
  opens.openTab('browser', { params: { url: 'https://example.com' } })
  expect(calls).toEqual([
    ['openResourceFor', sessionId, 'dsh-resource://file/session/chat-session/a.md', { params: { line: 2 } }],
    ['openTabFor', sessionId, 'browser', { params: { url: 'https://example.com' } }],
  ])
})

it('keeps the stock Sidebar opens when the Session-owned ones are absent', () => {
  const calls: unknown[][] = []
  const opens = sessionSidebar(recordingSidebar(calls), sessionId)
  opens.openResource('dsh-resource://file/session/chat-session/a.md')
  expect(calls).toEqual([['openResource', 'dsh-resource://file/session/chat-session/a.md', undefined]])
})
