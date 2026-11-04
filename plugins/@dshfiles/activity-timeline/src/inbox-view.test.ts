import { describe, expect, it } from 'vitest'
import type { AttentionItem } from './attention-api.js'
import { InboxView } from './inbox-view.js'

const item = (overrides: Partial<AttentionItem> = {}): AttentionItem => ({
  id: 'item-1',
  source: 'agent-questions.child-question',
  dedupeKey: 'q1',
  subject: { kind: 'session', id: 'session-1' },
  reason: 'A subagent asks',
  detail: null,
  severity: 'blocking',
  verbs: ['Answer', 'Open', 'Done', 'Snooze'],
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

describe('inbox view', () => {
  it('offers the reopen path for done and snoozed items, unmute for muted ones, and nothing for resolved ones', () => {
    expect(InboxView.undoOf(item({ doneAt: 5 }), 'closed')).toBe('reopen')
    expect(InboxView.undoOf(item({ snoozeUntilChange: true }), 'snoozed')).toBe('unsnooze')
    expect(InboxView.undoOf(item(), 'muted')).toBe('unmute')
    expect(InboxView.undoOf(item({ resolvedAt: 5 }), 'closed')).toBeNull()
    expect(InboxView.undoOf(item(), 'needs-you')).toBeNull()
  })

  it('turns snooze choices into a time or an until-it-changes target', () => {
    const now = new Date(2026, 10, 4, 13, 0, 0).getTime()
    expect(InboxView.snoozeTarget('hour', now)).toEqual({ until: now + 3_600_000 })
    expect(InboxView.snoozeTarget('change', now)).toEqual({ untilChange: true })
    const tomorrow = InboxView.snoozeTarget('tomorrow', now)
    expect('until' in tomorrow && new Date(tomorrow.until).getHours()).toBe(9)
  })

  it('names known sources in words and keeps unknown ids', () => {
    expect(InboxView.sourceLabel('agent-questions.child-question')).toBe('Subagent question')
    expect(InboxView.sourceLabel('jj-integration.ready-to-land')).toBe('Ready to land')
    expect(InboxView.sourceLabel('hmr-gate.deferred-update')).toBe('Restart needed')
    expect(InboxView.sourceLabel('custom.source')).toBe('custom.source')
  })
})
