import { describe, expect, it } from 'vitest'
import type { AttentionItem } from './attention-api.js'
import { InboxSwipe, InboxView } from './inbox-view.js'

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

  it('takes only the still-open items whose provider offers Resume for a bulk resume', () => {
    const resumable = item({ id: 'resumable', verbs: ['Resume', 'Open', 'Done', 'Snooze', 'MuteSource'] })
    const answered = item({ id: 'answered' })
    const done = item({ id: 'done', verbs: ['Resume', 'Open'], doneAt: 5 })
    const resolved = item({ id: 'resolved', verbs: ['Resume', 'Open'], resolvedAt: 5 })
    expect(InboxView.resumableIds([resumable, answered, done, resolved])).toEqual(['resumable'])
  })

  it('names known sources in words and keeps unknown ids', () => {
    expect(InboxView.sourceLabel('agent-questions.child-question')).toBe('Subagent question')
    expect(InboxView.sourceLabel('jj-integration.ready-to-land')).toBe('Ready to land')
    expect(InboxView.sourceLabel('hmr-gate.deferred-update')).toBe('Restart needed')
    expect(InboxView.sourceLabel('custom.source')).toBe('custom.source')
  })

  it('leads with the thread or item a ready item is about, not with its source sentence', () => {
    const readyToLand = item({
      source: 'jj-integration.ready-to-land',
      severity: 'ready',
      subject: { kind: 'session', id: 'session-2' },
      verbs: ['Land', 'Open', 'Done', 'Snooze'],
      reason: '“Ship the picker” is ready to land: 2 described revisions not on the bookmark yet.',
    })
    expect(InboxView.subjectTitleOf(readyToLand, () => 'Ship the picker')).toBe('Ship the picker')
    expect(InboxView.openActionOf(readyToLand)).toBe('thread')

    const finishedTurn = item({
      source: 'thread-sidebar.finished-turn',
      severity: 'ready',
      verbs: ['Open', 'Done', 'Snooze'],
      reason: 'Turn finished; ready to review.',
    })
    expect(InboxView.openActionOf(finishedTurn)).toBe('review')

    const waitingItem = item({
      source: 'backlog.attention',
      severity: 'ready',
      subject: { kind: 'backlog-item', id: '603', label: 'Make Other actionable' },
      verbs: ['Done', 'Snooze'],
      reason: 'b:kh4b Make Other actionable is waiting.',
    })
    expect(InboxView.subjectTitleOf(waitingItem, () => 'unused')).toBe('Make Other actionable')
    expect(InboxView.openActionOf(waitingItem)).toBe('subject')
  })
})

describe('InboxSwipe', () => {
  it('maps left to Done and right to Snooze, and never to Land, Approve or an answer', () => {
    const verbs = ['Done', 'Snooze', 'Land', 'Approve', 'Answer']
    expect(InboxSwipe.verb({ verbs }, 'needs-you', 'left')).toBe('done')
    expect(InboxSwipe.verb({ verbs }, 'other', 'right')).toBe('snooze')
    expect(InboxSwipe.verb({ verbs: ['Land', 'Approve', 'Answer'] }, 'needs-you', 'left')).toBeUndefined()
    expect(InboxSwipe.verb({ verbs: ['Land', 'Approve', 'Answer'] }, 'needs-you', 'right')).toBeUndefined()
  })
  it('does nothing on closed or muted items, and a snoozed item does not snooze again', () => {
    expect(InboxSwipe.verb({ verbs: ['Done', 'Snooze'] }, 'closed', 'left')).toBeUndefined()
    expect(InboxSwipe.verb({ verbs: ['Done', 'Snooze'] }, 'muted', 'right')).toBeUndefined()
    expect(InboxSwipe.verb({ verbs: ['Done', 'Snooze'] }, 'snoozed', 'right')).toBeUndefined()
    expect(InboxSwipe.verb({ verbs: ['Done', 'Snooze'] }, 'snoozed', 'left')).toBe('done')
  })
})
