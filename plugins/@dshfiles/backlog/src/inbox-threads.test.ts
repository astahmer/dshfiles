import { describe, expect, it } from 'vitest'

import type { BacklogSummaryView } from './api.js'
import { inboxThreadsFrom, linkedThreadIds } from './inbox-threads.js'

const item = (id: number, threads: readonly string[]): BacklogSummaryView => ({
  id,
  title: `Item ${String(id)}`,
  kind: 'task',
  status: 'doing',
  project: null,
  tags: [],
  links: threads.map(target => ({ type: 'thread', target })),
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
})

const records = [
  { sessionId: 'session-err', version: 2, finishedAt: 50, finishedReason: 'error' as const },
  { sessionId: 'session-done', version: 1, finishedAt: 40, finishedReason: 'completed' as const },
  { sessionId: 'session-unlinked', version: 1, finishedAt: 30, finishedReason: 'blocked' as const },
  { sessionId: 'session-manual', version: 1, finishedAt: null, finishedReason: null },
]
const items = [item(1, ['session-err', 'session-done']), item(2, ['session-manual'])]
const titles = new Map([['session-err', 'Migrate users']])

describe('inbox threads', () => {
  it('exposes linked working threads for inbox item actions', () => {
    const source = item(3, ['session-first', 'session-second'])
    const linked: BacklogSummaryView = { ...source, links: [...source.links, { type: 'url', target: 'https://example.com' }] }
    expect(linkedThreadIds(linked)).toEqual(['session-first', 'session-second'])
  })

  it('keeps only failed turns of threads linked to an item by default', () => {
    expect(
      inboxThreadsFrom({ mode: 'failures', records, items, titles }).map(thread => [thread.sessionId, thread.title, thread.items.map(entry => entry.id)]),
    ).toEqual([['session-err', 'Migrate users', [1]]])
  })

  it('adds finished turns waiting for review in all mode, and nothing when off', () => {
    expect(inboxThreadsFrom({ mode: 'all', records, items, titles }).map(thread => thread.reason)).toEqual(['error', 'completed'])
    expect(inboxThreadsFrom({ mode: 'off', records, items, titles })).toEqual([])
  })
})
