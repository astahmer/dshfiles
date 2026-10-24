import { describe, expect, it } from 'vitest'

import type { BacklogItem } from './item.js'
import { ThreadLifecycle } from './thread-lifecycle.js'

const item = (
  fields: Partial<Pick<BacklogItem, 'status' | 'humanFields' | 'proposal' | 'events'>> = {},
): Pick<BacklogItem, 'status' | 'humanFields' | 'proposal' | 'events'> => ({ status: 'doing', humanFields: [], proposal: null, events: [], ...fields })

describe('thread turn outcomes', () => {
  it('flags a thread that stopped blocked or failed, and clears the flag on a finished turn', () => {
    expect(ThreadLifecycle.outcome({ kind: 'blocked' })).toEqual({ stalled: true, reason: 'the thread stopped on a block' })
    expect(ThreadLifecycle.outcome({ kind: 'error', error: { code: 'RATE_LIMIT', message: 'too many requests' } })).toEqual({
      stalled: true,
      reason: 'the thread failed: RATE_LIMIT',
    })
    expect(ThreadLifecycle.outcome({ kind: 'completed' })).toEqual({ stalled: false, reason: 'the thread works again' })
  })

  it('leaves a cancellation, a token ceiling and an interrupted turn alone', () => {
    expect(ThreadLifecycle.outcome({ kind: 'aborted', reason: { kind: 'legacy' } })).toBeNull()
    expect(ThreadLifecycle.outcome({ kind: 'max-tokens' })).toBeNull()
    expect(ThreadLifecycle.outcome({ kind: 'interrupted' })).toBeNull()
  })
})

describe('thread replies', () => {
  it('reads the last thing the agent said, past later user messages', () => {
    expect(
      ThreadLifecycle.replyText([
        { role: 'assistant', content: [{ type: 'text', text: 'working on it' }] },
        { role: 'user', content: [{ type: 'text', text: 'ok' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Landed in jj:nozwvrtk.' }] },
      ]),
    ).toBe('Landed in jj:nozwvrtk.')
  })

  it('returns nothing when the thread never spoke or the turn only ran tools', () => {
    expect(ThreadLifecycle.replyText([])).toBe('')
    expect(
      ThreadLifecycle.replyText([
        { role: 'user', content: [{ type: 'text', text: 'b:12 go' }] },
        { role: 'assistant', content: [] },
      ]),
    ).toBe('')
  })
})

describe('idle thread nudges', () => {
  const linkedItem = (
    fields: Partial<Pick<BacklogItem, 'status' | 'attention' | 'humanFields' | 'links' | 'events'>> = {},
  ): Pick<BacklogItem, 'id' | 'status' | 'attention' | 'humanFields' | 'links' | 'events'> => ({
    id: 4,
    status: 'doing',
    attention: 'none',
    humanFields: [],
    links: [{ type: 'thread', target: 'session-abc' }],
    events: [],
    ...fields,
  })
  const session = (fields: Partial<{ sessionId: string; displayTitle: string; running: boolean; updatedAt: number }> = {}) => ({
    sessionId: 'session-abc',
    displayTitle: 'Implement feature',
    running: false,
    updatedAt: 2 * 86_400_000,
    ...fields,
  })

  it('nudges only unfinished items linked to an idle thread older than the configured cutoff', () => {
    expect(ThreadLifecycle.idleThreadNudges({ items: [linkedItem()], sessions: [session()], now: 9 * 86_400_000, idleDays: 7 })).toEqual([
      { id: 4, threadId: 'session-abc' },
    ])
    expect(
      ThreadLifecycle.idleThreadNudges({ items: [linkedItem()], sessions: [session({ updatedAt: 3 * 86_400_000 })], now: 9 * 86_400_000, idleDays: 7 }),
    ).toEqual([])
    expect(ThreadLifecycle.idleThreadNudges({ items: [linkedItem()], sessions: [session({ running: true })], now: 9 * 86_400_000, idleDays: 7 })).toEqual([])
    expect(ThreadLifecycle.idleThreadNudges({ items: [linkedItem({ status: 'done' })], sessions: [session()], now: 9 * 86_400_000, idleDays: 7 })).toEqual([])
    expect(
      ThreadLifecycle.idleThreadNudges({ items: [linkedItem({ attention: 'needs-input' })], sessions: [session()], now: 9 * 86_400_000, idleDays: 7 }),
    ).toEqual([])
    expect(
      ThreadLifecycle.idleThreadNudges({ items: [linkedItem({ humanFields: ['attention'] })], sessions: [session()], now: 9 * 86_400_000, idleDays: 7 }),
    ).toEqual([])
  })
})

describe('resolution candidates', () => {
  it('offers a done suggestion only for an in-progress item the user never touched', () => {
    expect(ThreadLifecycle.openToResolution(item())).toBe(true)
    expect(ThreadLifecycle.openToResolution(item({ status: 'done' }))).toBe(false)
    expect(ThreadLifecycle.openToResolution(item({ humanFields: ['status'] }))).toBe(false)
  })

  it('waits while a suggestion is open and after the user dismissed one', () => {
    expect(ThreadLifecycle.openToResolution(item({ proposal: { status: 'done', confidence: 0.6, reason: '', source: 'jev', at: 1 } }))).toBe(false)
    expect(ThreadLifecycle.openToResolution(item({ events: [{ at: 1, actor: 'user', kind: 'triaged', detail: 'dismissed status done' }] }))).toBe(false)
    expect(ThreadLifecycle.openToResolution(item({ events: [{ at: 1, actor: 'agent:session-abc', kind: 'commented', detail: 'still working' }] }))).toBe(true)
  })
})

describe('answered questions', () => {
  const asked = (
    fields: Partial<Pick<BacklogItem, 'attention' | 'humanFields' | 'events'>> = {},
  ): Pick<BacklogItem, 'attention' | 'humanFields' | 'events'> => ({
    attention: 'needs-input',
    humanFields: [],
    events: [
      {
        at: 1,
        actor: 'agent:session-abc',
        kind: 'edited',
        detail: 'attention',
        threadId: 'session-abc',
        fieldChanges: [{ field: 'attention', before: 'none', after: 'needs-input' }],
      },
    ],
    ...fields,
  })

  it('settles a request for input when the thread that asked reaches an answer', () => {
    expect(ThreadLifecycle.answeredQuestionSettles({ item: asked(), threadId: 'session-abc' })).toBe(true)
  })

  it('leaves a request another thread raised, or the user set, waiting for its own owner', () => {
    expect(ThreadLifecycle.answeredQuestionSettles({ item: asked(), threadId: 'session-other' })).toBe(false)
    expect(ThreadLifecycle.answeredQuestionSettles({ item: asked({ humanFields: ['attention'] }), threadId: 'session-abc' })).toBe(false)
    expect(ThreadLifecycle.answeredQuestionSettles({ item: asked({ attention: 'blocked' }), threadId: 'session-abc' })).toBe(false)
  })

  it('matches a legacy attention edit by the actor that wrote it, with no thread recorded', () => {
    const legacy = asked({ events: [{ at: 1, actor: 'agent:session-abc', kind: 'edited', detail: 'attention' }] })
    expect(ThreadLifecycle.answeredQuestionSettles({ item: legacy, threadId: 'session-abc' })).toBe(true)
    expect(ThreadLifecycle.answeredQuestionSettles({ item: asked({ events: [] }), threadId: 'session-abc' })).toBe(false)
  })
})
