import type { AttentionItem } from '@dshfiles/activity-timeline/attention-api'
import { describe, expect, it } from 'vitest'
import { InboxSignalsModel } from './inbox-signals.js'

const item = (overrides: Partial<AttentionItem>): AttentionItem => ({
  id: 'item',
  source: 'agent-questions.child-question',
  dedupeKey: 'k',
  subject: { kind: 'session', id: 'session-a' },
  reason: 'A question waits.',
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

describe('inbox signals', () => {
  it('keeps the most urgent open item per thread, with its first provider verb', () => {
    const signals = InboxSignalsModel.signalsOf([
      item({ id: 'ready', severity: 'ready', verbs: ['Land', 'Open'], openedAt: 9 }),
      item({ id: 'ask', severity: 'blocking', openedAt: 2 }),
      item({ id: 'retry', severity: 'failed', verbs: ['Retry', 'Open'], subject: { kind: 'session', id: 'session-b' } }),
    ])
    expect(signals.get('session-a')).toMatchObject({ itemId: 'ask', severity: 'blocking', verb: 'Answer' })
    expect(signals.get('session-b')).toMatchObject({ itemId: 'retry', severity: 'failed', verb: 'Retry' })
  })

  it('ignores items about something other than a thread, and closed or info items', () => {
    const signals = InboxSignalsModel.signalsOf([
      item({ id: 'ws', subject: { kind: 'workspace', id: 'session-a' } }),
      item({ id: 'done', doneAt: 5 }),
      item({ id: 'resolved', resolvedAt: 5 }),
      item({ id: 'info', severity: 'info' }),
    ])
    expect(signals.size).toBe(0)
  })
})
