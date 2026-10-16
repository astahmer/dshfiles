import { describe, expect, test } from 'vitest'
import { activityTimelineApi } from './api.js'

describe('activity-timeline tool exposure', () => {
  test('every activity read a human can take is a named, read-only tool', () => {
    const tools = Object.values(activityTimelineApi.methods).flatMap(method => (method.tool === undefined ? [] : [method.tool]))
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'activity_timeline_attention',
      'activity_timeline_event',
      'activity_timeline_page',
      'activity_timeline_related',
      'activity_timeline_stats',
    ])
    expect(tools.every(tool => tool.readOnly === true)).toBe(true)
    for (const method of Object.values(activityTimelineApi.methods)) {
      expect(method.description ?? method.tool?.description).toBeTruthy()
    }
  })
})
