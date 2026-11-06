import { describe, expect, it } from 'vitest'
import { FacetSessionStateModel } from './changes-facet-state.js'

describe('Changes facet session state', () => {
  const inThreadA = FacetSessionStateModel.update(FacetSessionStateModel.initial('session-a'), {
    sessionId: 'session-a',
    patch: { scope: 'turn', seq: 42, comment: 'half-written note', commentNotice: 'Added to your next message.', focusPath: 'src/a.ts' },
  })

  it('shows another thread with its own defaults, not the scope, turn or draft of the previous one', () => {
    expect(FacetSessionStateModel.forSession(inThreadA, 'session-b')).toEqual(FacetSessionStateModel.initial('session-b'))
  })

  it('starts a write for another thread from that thread, dropping the previous thread’s draft', () => {
    const inThreadB = FacetSessionStateModel.update(inThreadA, { sessionId: 'session-b', patch: { scope: 'thread' } })
    expect(inThreadB).toEqual({ ...FacetSessionStateModel.initial('session-b'), scope: 'thread' })
  })

  it('keeps everything while the thread stays the same', () => {
    expect(FacetSessionStateModel.forSession(inThreadA, 'session-a')).toBe(inThreadA)
    expect(FacetSessionStateModel.update(inThreadA, { sessionId: 'session-a', patch: { comment: 'more' } })).toMatchObject({ seq: 42, comment: 'more' })
  })
})
