import { describe, expect, it } from 'vitest'

import { createAiActivityTracker } from './ai-activity.js'

describe('AI activity tracking', () => {
  it('stays active until every concurrent task finishes', async () => {
    const tracker = createAiActivityTracker()
    let finishFirst: () => void = () => undefined
    let finishSecond: () => void = () => undefined
    const first = tracker.track(() => new Promise<void>(resolve => (finishFirst = resolve)))
    const second = tracker.track(() => new Promise<void>(resolve => (finishSecond = resolve)))

    expect(tracker.isActive()).toBe(true)
    finishFirst()
    await first
    expect(tracker.isActive()).toBe(true)
    finishSecond()
    await second
    expect(tracker.isActive()).toBe(false)
  })

  it('clears activity when the work fails', async () => {
    const tracker = createAiActivityTracker()
    await expect(tracker.track(async () => Promise.reject(new Error('failed')))).rejects.toThrow('failed')
    expect(tracker.isActive()).toBe(false)
  })
})
