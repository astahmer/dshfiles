// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ReadingFollowIntent } from '../src/native/chat/follow-policy.ts'
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
