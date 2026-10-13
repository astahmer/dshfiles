import { describe, expect, it } from 'vitest'

import { openMemoryStore, type ThreadDigest } from './store.ts'

const day = 86_400_000
const start = 1_760_000_000_000

const digest = (id: string, project: string, text: string, updatedAt = start): ThreadDigest => ({
  id,
  project,
  parent: null,
  title: `Thread ${id}`,
  decision: text.split('\n')[0] ?? text,
  digest: text,
  source: 'trail',
  lastSeq: 10,
  updatedAt,
})

const open = (clock = { now: start }) => openMemoryStore({ path: ':memory:', now: () => clock.now })

const note = (project: string, text: string) => ({
  project,
  text,
  category: 'project' as const,
  scope: 'repo',
  confidence: 'stated' as const,
  sourceThread: 'session-a',
  sourceSeq: null,
  origin: 'agent' as const,
})

describe('memory store', () => {
  it('finds exact identifiers by substring and words by stem', () => {
    const store = open()
    store.putThread(digest('session-a', '/p/halyard', 'Northwind Freight account ACC-77341 moved to the Enterprise tier.'))
    store.putThread(digest('session-b', '/p/halyard', 'Rebalancing consumers after the coordinator restarted.'))
    expect(
      store
        .search({ query: '77341', projects: [], limit: 3 })
        .map(hit => (hit.kind === 'thread' ? hit.id : ''))
        .at(0),
    ).toBe('session-a')
    expect(
      store
        .search({ query: 'rebalance consumer', projects: [], limit: 3 })
        .map(hit => (hit.kind === 'thread' ? hit.id : ''))
        .at(0),
    ).toBe('session-b')
  })

  it('stores identical digests and notes once', () => {
    const store = open()
    expect(store.putThread(digest('session-a', '/p/x', 'Same digest')).stored).toBe('new')
    expect(store.putThread(digest('session-b', '/p/x', 'Same digest')).stored).toBe('duplicate')
    expect(store.putThread(digest('session-a', '/p/x', 'Same digest')).stored).toBe('unchanged')
    expect(store.search({ query: 'same digest', projects: [], limit: 5 })).toHaveLength(1)
    const first = store.addNote(note('/p/x', 'Deploys need the ops approval label.'))
    const second = store.addNote(note('/p/x', '  deploys need the OPS approval label. '))
    expect(second).toEqual({ note: first.note, duplicate: true })
    expect(store.usage().notes).toBe(1)
  })

  it('supersedes a note on update and hides it on forget, keeping the history', () => {
    const store = open()
    const original = store.addNote(note('/p/x', 'Retention default is 48 hours.')).note
    const replacement = store.updateNote({
      id: original.id,
      text: 'Retention default is 72 hours.',
      reason: 'changed in 4.2.0',
      sourceThread: 'session-b',
      sourceSeq: 4,
      origin: 'agent',
    })
    expect(replacement?.supersedes).toBe(original.id)
    expect(store.note(original.id)).toBeUndefined()
    expect(store.search({ query: 'retention default', projects: [], limit: 5 }).map(hit => (hit.kind === 'note' ? hit.id : 0))).toEqual([replacement?.id])
    expect(store.forgetNote({ id: replacement?.id ?? 0, reason: 'no longer relevant' })).toBe(true)
    expect(store.search({ query: 'retention default', projects: [], limit: 5 })).toEqual([])
    expect(store.noteHistory(original.id).map(entry => [entry.text, entry.valid, entry.reason])).toEqual([
      ['Retention default is 48 hours.', false, 'changed in 4.2.0'],
      ['Retention default is 72 hours.', false, 'no longer relevant'],
    ])
  })

  it('keeps only an index of message text, never the text itself', () => {
    const store = open()
    store.indexMessages({
      thread: 'session-a',
      project: '/p/x',
      throughSeq: 3,
      messages: [{ seq: 2, role: 'user', text: 'Our admin API listens on 9644.', at: start }],
    })
    const hit = store.search({ query: '9644', projects: [], limit: 1 })[0]
    expect(hit).toMatchObject({ kind: 'message', thread: 'session-a', seq: 2 })
    expect(store.indexedThrough('session-a')).toBe(3)
    expect(JSON.stringify(store.usage())).not.toContain('9644')
  })

  it('drops digests and indexed messages past retention but keeps notes', () => {
    const clock = { now: start }
    const store = open(clock)
    store.putThread(digest('session-old', '/p/x', 'An old investigation of INC-100.'))
    store.indexMessages({ thread: 'session-old', project: '/p/x', throughSeq: 1, messages: [{ seq: 1, role: 'user', text: 'INC-100 details', at: start }] })
    store.addNote(note('/p/x', 'INC-100 was caused by a config push.'))
    clock.now = start + 400 * day
    store.putThread(digest('session-new', '/p/x', 'A new thread about INC-200.', clock.now))
    expect(store.prune(365)).toEqual({ threads: 1, messages: 1 })
    expect(store.thread('session-old')).toBeUndefined()
    expect(store.search({ query: 'INC-100', projects: [], limit: 5 }).flatMap(hit => (hit.kind === 'thread' ? [] : [hit.kind]))).toEqual(['note'])
    expect(store.thread('session-new')).toBeDefined()
  })

  it('counts a citation as use of the tool call that returned the id and of the cited item', () => {
    const store = open()
    store.putThread(digest('session-3f2a9c1e', '/p/x', 'Digest'))
    store.recordToolCall({ thread: 'session-reader', tool: 'memory_search', results: 1, ids: ['t:3f2a9c1e'] })
    store.recordToolCall({ thread: 'session-reader', tool: 'memory_read', results: 1, ids: ['n:9'] })
    expect(store.markCited({ thread: 'session-reader', cited: ['t:3f2a9c1e'], sinceMs: 60_000 })).toBe(1)
    store.recordUse({ kind: 'thread', id: 'session-3f2a9c1e' }, 'session-reader')
    expect(store.usage().tools).toEqual([
      { tool: 'memory_read', calls: 1, withResults: 1, used: 0 },
      { tool: 'memory_search', calls: 1, withResults: 1, used: 1 },
    ])
    expect(store.thread('3f2a9c1e')?.uses).toBe(1)
    expect(store.usageByDay(7)).toEqual([{ day: '2025-10-09', searches: 1, reads: 1, notes: 0, cited: 1, citations: 1 }])
  })

  it('ranks the caller project first and keeps old exact matches findable', () => {
    const clock = { now: start }
    const store = open(clock)
    store.putThread(digest('session-other', '/p/other', 'Kafka partition lag alert thresholds.'))
    store.putThread(digest('session-own', '/p/own', 'Kafka partition lag alert thresholds for Halyard.'))
    store.putThread(digest('session-ancient', '/p/own', 'The broker id for staging is BRK-4471.', start - 300 * day))
    const hits = store.search({ query: 'partition lag alert', projects: [], ownProject: '/p/own', limit: 2 })
    expect(hits.map(hit => hit.project)).toEqual(['/p/own', '/p/other'])
    expect(store.search({ query: 'BRK-4471', projects: [], ownProject: '/p/own', limit: 1 }).map(hit => (hit.kind === 'thread' ? hit.id : ''))).toEqual([
      'session-ancient',
    ])
  })
})
