import { describe, expect, test } from 'vitest'
import { JevChatTurnTimeline } from './jev-chat-turn-timeline.js'

describe('JevChatTurnTimeline', () => {
  test('only offers on the greatest observed turn in each session', () => {
    const timeline = new JevChatTurnTimeline()
    let notifications = 0
    const unsubscribe = timeline.subscribe(() => {
      notifications += 1
    })

    timeline.publish('session-a', 2)
    expect(timeline.isLatest('session-a', 2)).toBe(true)
    expect(timeline.isLatest('session-a', 1)).toBe(false)
    expect(notifications).toBe(1)

    timeline.publish('session-a', 1)
    expect(timeline.isLatest('session-a', 2)).toBe(true)
    expect(notifications).toBe(1)

    timeline.publish('session-a', 3)
    expect(timeline.isLatest('session-a', 2)).toBe(false)
    expect(timeline.isLatest('session-a', 3)).toBe(true)
    expect(notifications).toBe(2)

    timeline.publish('session-b', 1)
    expect(timeline.isLatest('session-a', 3)).toBe(true)
    expect(timeline.isLatest('session-b', 1)).toBe(true)
    expect(notifications).toBe(3)
    unsubscribe()
  })
})
