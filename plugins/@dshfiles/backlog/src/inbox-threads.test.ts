import { describe, expect, it } from 'vitest'

import type { BacklogSummaryView } from './api.js'
import { summaryRelationDefaults } from './summary-fixture.js'
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
  ...summaryRelationDefaults,
})

const records = [
  { sessionId: 'session-e11e11e1', version: 2, finishedAt: 50, finishedReason: 'error' as const },
  { sessionId: 'session-d0d0d0d0', version: 1, finishedAt: 40, finishedReason: 'completed' as const },
  { sessionId: 'session-b10c4e11', version: 1, finishedAt: 30, finishedReason: 'blocked' as const },
  { sessionId: 'session-a11a11a1', version: 1, finishedAt: null, finishedReason: null },
]
const items = [item(1, ['session-e11e11e1', 'session-d0d0d0d0']), item(2, ['session-a11a11a1'])]
const titles = new Map([['session-e11e11e1', 'Migrate users']])

describe('inbox threads', () => {
  it('exposes linked working threads for inbox item actions', () => {
    const source = item(3, ['session-f1f2f3f4', 'session-c1c2c3c4'])
    const linked: BacklogSummaryView = { ...source, links: [...source.links, { type: 'url', target: 'https://example.com' }] }
    expect(linkedThreadIds(linked)).toEqual(['session-f1f2f3f4', 'session-c1c2c3c4'])
  })

  it('ignores a thread-shaped word from prose that is not a session id', () => {
    const source = item(4, ['session-controller', 'session-history', 'session-9e185ebf'])
    expect(linkedThreadIds(source)).toEqual(['session-9e185ebf'])
  })

  it('keeps only failed turns of threads linked to an item by default', () => {
    expect(
      inboxThreadsFrom({ mode: 'failures', records, items, titles }).map(thread => [thread.sessionId, thread.title, thread.items.map(entry => entry.id)]),
    ).toEqual([['session-e11e11e1', 'Migrate users', [1]]])
  })

  it('adds finished turns waiting for review in all mode, and nothing when off', () => {
    expect(inboxThreadsFrom({ mode: 'all', records, items, titles }).map(thread => thread.reason)).toEqual(['error', 'completed'])
    expect(inboxThreadsFrom({ mode: 'off', records, items, titles })).toEqual([])
  })
})
