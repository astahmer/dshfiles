import { describe, expect, it } from 'vitest'

import type { BacklogSummaryView } from './api.js'
import { sortBacklogItems } from './backlog-sort.js'

const item = (id: number, createdAt: number, lastActivityAt: number): BacklogSummaryView => ({
  id,
  title: `Item ${String(id)}`,
  kind: 'task',
  status: 'todo',
  project: null,
  tags: [],
  links: [],
  attachments: [],
  actors: [],
  pinned: false,
  freshness: 'fresh',
  createdAt,
  lastActivityAt,
  preview: '',
  proposal: null,
  attention: 'none',
  acknowledgedAt: null,
  snoozedUntil: null,
  activity: { count: 0, agents: 0, comments: 0, last: null },
  match: null,
})

const items = [item(1, 10, 30), item(2, 20, 10), item(3, 30, 20)]

describe('backlog sorting', () => {
  it('sorts by creation date without changing the source list', () => {
    expect(sortBacklogItems(items, 'created').map(entry => entry.id)).toEqual([3, 2, 1])
    expect(items.map(entry => entry.id)).toEqual([1, 2, 3])
  })

  it('sorts by last update in feed order when requested', () => {
    expect(sortBacklogItems(items, 'updated', 'ascending').map(entry => entry.id)).toEqual([2, 3, 1])
  })
})
