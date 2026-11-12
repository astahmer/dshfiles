import { describe, expect, it } from 'vitest'
import type { AttentionItem } from './attention-api.js'
import { InboxNotifications } from './inbox-notifications.js'

const item = (overrides: Partial<AttentionItem> = {}): AttentionItem => ({
  id: 'item-1',
  source: 'agent-questions.child-question',
  dedupeKey: 'q-1',
  subject: { kind: 'session', id: 'session-parent' },
  reason: 'A subagent asks: deploy to staging now?',
  detail: null,
  severity: 'blocking',
  verbs: ['Answer', 'Open', 'Done'],
  choices: [],
  fingerprint: 'f',
  createdAt: 1,
  openedAt: 1,
  updatedAt: 1,
  occurrences: 1,
  resolvedAt: null,
  doneAt: null,
  snoozedUntil: null,
  snoozeUntilChange: false,
  ...overrides,
})

const titles = new Map([['session-parent', 'Ship the billing page']])
const label = (sessionId: string): string => titles.get(sessionId) ?? `Thread ${sessionId}`

describe('inbox browser notifications', () => {
  it('titles a notification with the thread and says the question in its body', () => {
    expect(InboxNotifications.notificationOf(item(), label)).toEqual({
      title: 'Ship the billing page',
      body: 'A subagent asks: deploy to staging now?',
      tag: 'dshfiles-attention-item-1',
    })
  })

  it('says the failure and the first line of its recovery, and names a non-thread subject by its label', () => {
    const failed = item({
      id: 'item-2',
      severity: 'failed',
      reason: '“Fix login” has 1 conflicted revision; Land is blocked.',
      detail: 'Conflicted: qpvuntsm. Resolve them in the thread, then Retry.\nMore context.',
      subject: { kind: 'workspace', id: '/repo-threads/thread-abc123', label: 'Fix login' },
    })
    expect(InboxNotifications.notificationOf(failed, label)).toEqual({
      title: 'Fix login',
      body: '“Fix login” has 1 conflicted revision; Land is blocked. Conflicted: qpvuntsm. Resolve them in the thread, then Retry.',
      tag: 'dshfiles-attention-item-2',
    })
    expect(InboxNotifications.notificationOf(item({ reason: 'x'.repeat(400) }), label).body).toHaveLength(240)
  })

  it('announces new questions and failures once, never Ready items, and nothing from the first list', () => {
    const question = item()
    const failure = item({ id: 'item-2', severity: 'failed' })
    const ready = item({ id: 'item-3', severity: 'ready' })
    expect(InboxNotifications.newAlerts(null, [question, failure, ready])).toEqual([])
    expect(InboxNotifications.newAlerts(new Set(), [question, failure, ready])).toEqual([question, failure])
    expect(InboxNotifications.newAlerts(new Set(['item-1:1']), [question, failure])).toEqual([failure])
    // The same item opening again later is a new occurrence and alerts again.
    expect(InboxNotifications.newAlerts(new Set(['item-1:1']), [item({ openedAt: 9 })])).toHaveLength(1)
  })
})
