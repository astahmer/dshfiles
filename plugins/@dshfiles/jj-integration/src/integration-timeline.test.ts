import { describe, expect, it } from 'vitest'
import { IntegrationTimeline } from './integration-timeline.js'

const integrations = [{ at: 150, tipChangeId: 'first' }, { at: 250, tipChangeId: 'second' }, { at: 260 }]

describe('IntegrationTimeline', () => {
  it('shows each land once, after the Turn it followed', () => {
    const timeline = new IntegrationTimeline()
    for (const [turn, startedAt] of [
      [1, 100],
      [2, 200],
      [3, 300],
    ] as const)
      timeline.publishTurnStart({ sessionId: 's', turn, startedAt })

    const markersOf = (turn: number, turnStartedAt: number) =>
      IntegrationTimeline.forTurn({ integrations, turnStartedAt, nextTurnStartedAt: timeline.nextTurnStartedAt({ sessionId: 's', turn }) })

    expect(markersOf(1, 100).map(record => record.tipChangeId)).toEqual(['first'])
    expect(markersOf(2, 200).map(record => record.at)).toEqual([250, 260])
    expect(markersOf(3, 300)).toEqual([])
  })

  it('gives the latest Turn the land that happened after it ended', () => {
    const timeline = new IntegrationTimeline()
    timeline.publishTurnStart({ sessionId: 's', turn: 1, startedAt: 100 })

    expect(
      IntegrationTimeline.forTurn({ integrations, turnStartedAt: 100, nextTurnStartedAt: timeline.nextTurnStartedAt({ sessionId: 's', turn: 1 }) }),
    ).toHaveLength(3)
  })

  it('tells subscribers when a later Turn bounds an earlier one, and not for another Session', () => {
    const timeline = new IntegrationTimeline()
    let notifications = 0
    timeline.subscribe(() => {
      notifications += 1
    })
    timeline.publishTurnStart({ sessionId: 's', turn: 2, startedAt: 200 })
    timeline.publishTurnStart({ sessionId: 's', turn: 2, startedAt: 200 })

    expect(notifications).toBe(1)
    expect(timeline.nextTurnStartedAt({ sessionId: 's', turn: 1 })).toBe(200)
    expect(timeline.nextTurnStartedAt({ sessionId: 'other', turn: 1 })).toBeUndefined()
  })
})
