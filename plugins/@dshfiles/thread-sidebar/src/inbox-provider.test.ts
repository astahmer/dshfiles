import { describe, expect, it } from 'vitest'
import { FinishedTurnAttention } from './inbox-provider.js'

describe('thread-sidebar inbox provider', () => {
  it('states each unacknowledged turn as its own ready or failed occurrence and a hand-made unread mark as one item', () => {
    const drafts = FinishedTurnAttention.draftsOf([
      { sessionId: 'session-a', version: 2, finishedAt: 10, finishedSeq: 7, finishedReason: 'completed', manuallyUnread: false },
      { sessionId: 'session-b', version: 3, finishedAt: 11, finishedSeq: 4, finishedReason: 'error', manuallyUnread: false },
      { sessionId: 'session-c', version: 4, finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true },
      { sessionId: 'session-d', version: 5, finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: false },
    ])
    expect(drafts.map(draft => [draft.dedupeKey, draft.severity])).toEqual([
      ['session-a:turn:7', 'ready'],
      ['session-b:turn:4', 'failed'],
      ['session-c:unread', 'ready'],
    ])
    expect(drafts.every(draft => draft.subject.kind === 'session' && draft.verbs.includes('Open'))).toBe(true)
  })
})
