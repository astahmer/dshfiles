// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ownInputOf, ReadingFollowIntent, type OwnInputFacts } from '../src/native/chat/follow-policy.ts'
import { LocalFollowIntent, ScrollFollow } from '../src/native/chat/use-scroll-follow.ts'

describe('reading follow intent', () => {
  it('reports one value for follow state and its pending sample', () => {
    const intent = new ReadingFollowIntent(false)
    expect(intent.following).toBe(false)
    expect(intent.pending).toBe(false)
    intent.beginSample()
    expect(intent.pending).toBe(true)
    expect(intent.following).toBe(false)
    intent.setFollowing(true)
    expect(intent.following).toBe(true)
    expect(intent.pending).toBe(true)
    intent.endSample()
    expect(intent.pending).toBe(false)
    expect(intent.following).toBe(true)
    intent.setFollowing(false)
    expect(intent.pending).toBe(false)
    expect(intent.following).toBe(false)
  })

  it('cannot leave a sample pending after the intent is released for navigation', () => {
    const intent = new ReadingFollowIntent(true)
    intent.beginSample()
    intent.setFollowing(false)
    intent.endSample()
    expect(intent.pending).toBe(false)
    intent.beginSample()
    intent.endSample()
    intent.endSample()
    expect(intent.pending).toBe(false)
    expect(intent.following).toBe(false)
  })
})

describe('scroll follow', () => {
  const metrics = (top: number) => ({ top, height: 400, floor: 600 })

  it('adopts follow intent through its owner instead of keeping a second boolean', () => {
    const intent = new ReadingFollowIntent(false)
    const follow = new ScrollFollow(intent, 4)
    expect(follow.active).toBe(false)
    follow.toBottom(document.createElement('div'), { top: 0, height: 400, floor: 0 }, 'instant')
    expect(intent.following).toBe(true)
    expect(follow.active).toBe(true)
    follow.setFollowing(false)
    expect(intent.following).toBe(false)
    expect(follow.animating).toBe(false)
  })

  it('lets a reader sample settle the owner it shares with the reading policy', () => {
    const intent = new LocalFollowIntent(true)
    const follow = new ScrollFollow(intent, 4)
    follow.sample(metrics(10), true)
    expect(intent.following).toBe(false)
    follow.sample(metrics(596), true)
    expect(intent.following).toBe(true)
  })
})

describe('what counts as the reader\'s own input', () => {
  const settled: OwnInputFacts = {
    lastKey: 'answer-1', lastIsUser: false, steeringId: null, submissionId: null, pendingInteraction: null,
  }

  it('follows a message the reader sent, as before', () => {
    expect(ownInputOf(settled, { ...settled, lastKey: 'user-2', lastIsUser: true })).toEqual({ own: true, steering: false, submission: false })
    expect(ownInputOf(settled, { ...settled, submissionId: 'request-2' })).toEqual({ own: true, steering: false, submission: true })
    expect(ownInputOf(settled, { ...settled, steeringId: 'rpc-2' })).toEqual({ own: true, steering: true, submission: false })
  })

  it('follows an answered question like a sent message, so the reply comes into view (round three F6)', () => {
    const asking = { ...settled, pendingInteraction: 'question-7' }
    expect(ownInputOf(settled, asking).own).toBe(false)
    expect(ownInputOf(asking, { ...asking, pendingInteraction: null })).toEqual({ own: true, steering: false, submission: false })
    // A question replaced by the next one is still waiting on the reader.
    expect(ownInputOf(asking, { ...asking, pendingInteraction: 'question-8' }).own).toBe(false)
  })

  it('treats the first sample as no input', () => {
    expect(ownInputOf(null, { ...settled, pendingInteraction: null }).own).toBe(false)
  })
})
