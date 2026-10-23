import { describe, expect, it } from 'vitest'

import type { BacklogSummaryView } from './api.js'
import { inboxRows, type InboxFilter } from './inbox-model.js'
import { inboxThreadsFrom, type InboxThread } from './inbox-threads.js'

const item = (input: Partial<BacklogSummaryView> & Pick<BacklogSummaryView, 'id'>): BacklogSummaryView => ({
  title: `Item ${String(input.id)}`,
  kind: 'task',
  status: 'doing',
  project: null,
  tags: [],
  links: [],
  attachments: [],
  actors: [],
  pinned: false,
  freshness: 'fresh',
  createdAt: 0,
  lastActivityAt: 0,
  preview: '',
  proposal: null,
  attention: 'none',
  acknowledgedAt: null,
  snoozedUntil: null,
  activity: { count: 0, agents: 0, comments: 0, last: null },
  match: null,
  ...input,
})

const thread = (sessionId: string, items: readonly BacklogSummaryView[], reason: InboxThread['reason'] = 'error'): InboxThread => ({
  sessionId,
  version: 1,
  reason,
  at: 10,
  title: sessionId,
  items,
})

const proposal: NonNullable<BacklogSummaryView['proposal']> = { status: 'todo', confidence: 0.5, reason: '', source: 'jev', at: 1 }

describe('item-centric inbox', () => {
  it('merges ordinary item and multiple unread thread reasons into one row with distinct actions', () => {
    const source = item({ id: 162, attention: 'needs-input' })
    const first = thread('first', [source])
    const second = thread('second', [source], 'blocked')
    const rows = inboxRows({ items: [source, source], threads: [first, second, first] })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.threads.map(entry => [entry.sessionId, entry.version, entry.reason])).toEqual([
      ['first', 1, 'error'],
      ['second', 1, 'blocked'],
    ])
    expect(rows[0]?.hasItemReason).toBe(true)
  })

  it('keeps one row per item when a single unread thread works on multiple items', () => {
    const sources = [item({ id: 1 }), item({ id: 2 })]
    const shared = thread('shared', sources)
    const rows = inboxRows({ items: [], threads: [shared] })
    expect(rows.map(row => row.item.id).sort()).toEqual([1, 2])
    expect(rows.every(row => row.threads[0] === shared)).toBe(true)
    expect(rows.every(row => !row.hasItemReason)).toBe(true)
    expect(inboxRows({ items: [], threads: [] })).toEqual([])
  })

  it('never resurfaces done or dropped items from historical linked threads', () => {
    const sources = [item({ id: 1, status: 'done', attention: 'blocked' }), item({ id: 2, status: 'dropped', proposal }), item({ id: 3 })]
    const records = [{ sessionId: 'shared', version: 1, finishedAt: 10, finishedReason: 'error' as const }]
    const linked = sources.map(source => ({ ...source, links: [{ type: 'thread' as const, target: 'shared' }] }))
    const threads = inboxThreadsFrom({ mode: 'all', records, items: linked, titles: new Map() })
    expect(threads[0]?.items.map(source => source.id)).toEqual([3])
    expect(inboxRows({ items: sources, threads: [thread('historical', sources)] }).map(row => row.item.id)).toEqual([3])
  })

  it('uses unique filtered rows for counts, preserving item reasons independently of thread reasons', () => {
    const needsInput = item({ id: 1, attention: 'needs-input' })
    const suggestion = item({ id: 2, proposal })
    const waiting = item({ id: 3, attention: 'waiting' })
    const threadOnly = item({ id: 4 })
    const completedOnly = item({ id: 5 })
    const sources = [needsInput, suggestion, waiting]
    const threads = [thread('complete', [needsInput, suggestion, completedOnly], 'completed'), thread('failed', [threadOnly, threadOnly])]
    const expected = { all: [1, 2, 3, 4, 5], 'needs-input': [1], blocked: [3, 4], suggestions: [2] } satisfies Record<InboxFilter, number[]>
    for (const filter of ['all', 'needs-input', 'blocked', 'suggestions'] satisfies InboxFilter[]) {
      const rows = inboxRows({ items: sources, threads, filter })
      expect(rows.map(row => row.item.id).sort()).toEqual(expected[filter])
      expect(rows).toHaveLength(new Set(rows.map(row => row.item.id)).size)
    }
    expect(inboxRows({ items: sources, threads: [], filter: 'needs-input' })[0]?.item.id).toBe(1)
    expect(inboxRows({ items: sources, threads: [], filter: 'suggestions' })[0]?.item.id).toBe(2)
  })

  it('acknowledging a thread does not resolve item attention or suggestions', () => {
    const source = item({ id: 1, attention: 'needs-input', proposal })
    const unread = thread('first', [source])
    expect(inboxRows({ items: [source], threads: [unread] })).toHaveLength(1)
    const acknowledged = inboxRows({ items: [source], threads: [] })
    expect(acknowledged[0]).toEqual({ item: source, threads: [], hasItemReason: true })
    expect(inboxRows({ items: [], threads: [thread('first', [item({ id: 1 })])] })[0]?.hasItemReason).toBe(false)
  })
})
