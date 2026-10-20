import { describe, expect, it } from 'vitest'
import type { BacklogSummaryView } from './api.js'
import type { BacklogStatus } from './item.js'
import { FeedStatus } from './status-filter.js'

const summary = (id: number, status: BacklogStatus): BacklogSummaryView => ({
  id,
  title: `Item ${String(id)}`,
  kind: 'task',
  status,
  project: null,
  tags: [],
  links: [],
  attachments: [],
  actors: [{ id: 'user', role: 'owner' }],
  pinned: false,
  freshness: 'fresh',
  createdAt: id,
  lastActivityAt: id,
  preview: '',
  proposal: null,
  attention: 'none',
  acknowledgedAt: null,
  snoozedUntil: null,
  activity: { count: 0, agents: 0, comments: 0, last: null },
  match: null,
})

describe('feed status filter', () => {
  it('shows every status until a chip is picked, then only the picked ones', () => {
    const items = [summary(1, 'inbox'), summary(2, 'doing'), summary(3, 'done')]
    expect(FeedStatus.filter(items, []).map(item => item.id)).toEqual([1, 2, 3])
    expect(FeedStatus.filter(items, ['doing']).map(item => item.id)).toEqual([2])
    expect(FeedStatus.filter(items, ['inbox', 'done']).map(item => item.id)).toEqual([1, 3])
  })

  it('adds a status to the selection and removes it again, falling back to All', () => {
    expect(FeedStatus.toggle([], 'doing')).toEqual(['doing'])
    expect(FeedStatus.toggle(['doing'], 'todo')).toEqual(['doing', 'todo'])
    expect(FeedStatus.toggle(['doing', 'todo'], 'doing')).toEqual(['todo'])
    expect(FeedStatus.toggle(['todo'], 'todo')).toEqual([])
  })

  it('counts every status, including the ones with no items', () => {
    const counts = FeedStatus.counts([summary(1, 'inbox'), summary(2, 'inbox'), summary(3, 'doing')])
    expect(counts).toEqual({ inbox: 2, todo: 0, doing: 1, done: 0, dropped: 0 })
  })
})
