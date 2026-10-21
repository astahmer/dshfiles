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
