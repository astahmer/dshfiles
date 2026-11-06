import { describe, expect, test } from 'vitest'

import { activityFeedKeys, activityFeedQueries, type ActivityFeedFilter } from './feed-queries.js'
import type { ActivityPage, CondensedItem } from './types.js'

const filter = (change: Partial<ActivityFeedFilter> = {}): ActivityFeedFilter => ({
  search: '',
  sources: [],
  attentionOnly: false,
  detailed: false,
  ...change,
})

const item = (id: string, at: number): CondensedItem => ({
  kind: 'event',
  id,
  at,
  source: 'session',
  type: 'turn',
  level: 'routine',
  sessionId: null,
  correlationId: null,
  summary: id,
  count: 1,
  eventIds: [id],
  references: [],
})

const page = (items: readonly CondensedItem[], nextCursor: string | null): ActivityPage => ({
  items,
  nextCursor,
  hasMore: nextCursor !== null,
  newestAt: null,
  attentionCount: 0,
  totalRetained: 0,
})

describe('activity feed paging', () => {
  test('keys the feed by every part of the filter, so a filter change starts paging over', () => {
    const base = activityFeedKeys.feed(filter())
    expect(base).toEqual(['activity-timeline', 'feed', '', '', false, false])
    expect(activityFeedKeys.feed(filter({ search: 'jj' }))).not.toEqual(base)
    expect(activityFeedKeys.feed(filter({ sources: ['session'] }))).not.toEqual(base)
    expect(activityFeedKeys.feed(filter({ attentionOnly: true }))).not.toEqual(base)
    expect(activityFeedKeys.feed(filter({ detailed: true }))).not.toEqual(base)
    // The sources read the same however the chips were clicked, so reordering them keeps the loaded pages.
    expect(activityFeedKeys.filter(filter({ sources: ['system', 'session'] }))).toEqual(activityFeedKeys.filter(filter({ sources: ['session', 'system'] })))
  })

  test('omits an absent filter and sends the cursor only once there is one', () => {
    expect(activityFeedQueries.pageInput({ filter: filter(), cursor: null, limit: 80 })).toEqual({ detailed: false, limit: 80 })
    const older = activityFeedQueries.pageInput({ filter: filter({ search: 'jj', sources: ['session'], attentionOnly: true }), cursor: 'cursor-2', limit: 80 })
    expect(older).toEqual({ search: 'jj', sources: ['session'], levels: ['attention'], detailed: false, limit: 80, cursor: 'cursor-2' })
  })

  test('reads the first page as the live tail and every later page as older history', () => {
    const newest = page([item('d', 4), item('c', 3)], 'cursor-2')
    const older = page([item('b', 2), item('a', 1)], null)
    expect(activityFeedQueries.items([newest, older])).toEqual({ newest: newest.items, older: [item('b', 2), item('a', 1)] })
    expect(activityFeedQueries.items([newest])).toEqual({ newest: newest.items, older: [] })
    expect(activityFeedQueries.items([])).toEqual({ newest: [], older: [] })
  })
})
