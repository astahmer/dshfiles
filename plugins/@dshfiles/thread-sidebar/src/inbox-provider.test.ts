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

  it('matches Done in the inbox to the thread record only while the item is its current turn', () => {
    const views = [{ sessionId: 'session-a', version: 2, finishedAt: 10, finishedSeq: 7, finishedReason: 'completed' as const, manuallyUnread: false }]
    const item = (dedupeKey: string, source = 'thread-sidebar.finished-turn') => ({ source, dedupeKey, subject: { kind: 'session' as const, id: 'session-a' } })
    expect(FinishedTurnAttention.viewForDoneItem(item('session-a:turn:7'), views)?.version).toBe(2)
    // An older turn's item, or another provider's item about the same thread, leaves the dot alone.
    expect(FinishedTurnAttention.viewForDoneItem(item('session-a:turn:3'), views)).toBeUndefined()
    expect(FinishedTurnAttention.viewForDoneItem(item('session-a:turn:7', 'agent-questions.child-question'), views)).toBeUndefined()
  })
})
