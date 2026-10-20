import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

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

  it('rekeys workspace memory rows to their JJ project and is idempotent', () => {
    const store = open()
    const from = '/p/project-threads/thread-a'
    const to = '/p/project'
    const storedNote = store.addNote(note(from, 'Repository uses a stable checkpoint.')).note
    store.putThread(digest('session-a', from, 'Workspace digest includes a checkpoint.'))
    store.indexMessages({
      thread: 'session-a',
      project: from,
      throughSeq: 1,
      messages: [{ seq: 1, role: 'user', text: 'Review the checkpoint before landing.', at: start }],
    })
    store.putEmbedding({ kind: 'thread', ref: 'session-a', project: from, model: 'test-model', vector: new Float32Array([0.25, 0.75]) })

    expect(store.projectPaths()).toEqual([from])
    expect(store.rekeyProject({ from, to })).toMatchObject({
      from,
      to,
      moved: { notes: 1, threads: 1, messages: 1, embeddings: 1, docsWords: 2, docsIds: 2 },
      conflicts: [],
    })
    expect(store.projectPaths()).toEqual([to])
    expect(store.note(storedNote.id)?.project).toBe(to)
    expect(store.thread('session-a')?.project).toBe(to)
    const hits = store.search({ query: 'checkpoint', projects: [to], limit: 10 })
    expect(hits).toHaveLength(3)
    expect(hits.every(hit => hit.project === to)).toBe(true)
    expect(store.rekeyProject({ from, to }).moved).toEqual({ notes: 0, threads: 0, messages: 0, embeddings: 0, docsWords: 0, docsIds: 0 })
  })

  it('includes invalid note history in project-path backfills', () => {
    const store = open()
    const from = '/p/project-threads/forgotten'
    const to = '/p/project'
    const oldNote = store.addNote(note(from, 'An obsolete project setting.')).note
    store.forgetNote({ id: oldNote.id, reason: 'replaced' })

    expect(store.projects()).toEqual([])
    expect(store.projectPaths()).toEqual([from])
    expect(store.rekeyProject({ from, to }).moved.notes).toBe(1)
    expect(store.noteHistory(oldNote.id).map(entry => entry.project)).toEqual([to])
    expect(store.projectPaths()).toEqual([to])
  })

  it('rejects all project rekeys when source paths collide with each other', () => {
    const store = open()
    const unique = '/p/project-threads/unique'
    const first = '/p/project-threads/first'
    const second = '/p/project-threads/second'
    const to = '/p/project'
    store.putThread(digest('session-unique', unique, 'Unique digest.'))
    store.addNote(note(first, 'Duplicate history across workspaces.'))
    store.addNote(note(second, 'Duplicate history across workspaces.'))

    const result = store.rekeyProjects({
      mappings: [
        { from: unique, to },
        { from: first, to },
        { from: second, to },
      ],
    })

    expect(result.projects).toBe(0)
    expect(result.conflicts).toEqual([{ kind: 'note', target: to, collisions: 1 }])
    expect(store.thread('session-unique')?.project).toBe(unique)
    expect(store.projectPaths()).toEqual([first, second, unique])
  })

  it('keeps note and digest collisions separate during project rekeying', () => {
    const store = open()
    const from = '/p/project-threads/thread-a'
    const to = '/p/project'
    const sourceNote = store.addNote(note(from, 'Shared setup requirement.')).note
    store.addNote(note(to, 'Shared setup requirement.'))
    store.putThread(digest('session-source', from, 'Same digest.'))
    store.putThread(digest('session-target', to, 'Same digest.'))

    const result = store.rekeyProject({ from, to })

    expect(result.moved).toEqual({ notes: 0, threads: 0, messages: 0, embeddings: 0, docsWords: 0, docsIds: 0 })
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        { kind: 'note', target: to, collisions: 1 },
        { kind: 'thread', target: to, collisions: 1 },
      ]),
    )
    expect(store.note(sourceNote.id)?.project).toBe(from)
    expect(store.thread('session-source')?.project).toBe(from)
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

  it('counts notes by lifecycle state and ranks the most-cited valid notes', () => {
    const store = open()
    const cited = store.addNote(note('/p/x', 'Nightly runs start after the cache warms.')).note
    const replaced = store.addNote(note('/p/x', 'Deploys need the ops approval label.')).note
    const forgotten = store.addNote(note('/p/x', 'The old canary window is two hours.')).note
    store.updateNote({
      id: replaced.id,
      text: 'Deploys need the ops-approval label and a green canary.',
      reason: 'tightened',
      sourceThread: null,
      sourceSeq: null,
      origin: 'panel',
    })
    store.forgetNote({ id: forgotten.id, reason: 'obsolete' })
    store.recordUse({ kind: 'note', id: cited.id }, 'session-reader')
    store.recordUse({ kind: 'note', id: cited.id }, 'session-writer')
    expect(store.noteStatusCounts()).toEqual({ active: 2, superseded: 1, forgotten: 1 })
    expect(store.noteStatusCounts('/p/x')).toEqual({ active: 2, superseded: 1, forgotten: 1 })
    expect(store.topNotes(5).map(entry => [entry.id, entry.uses])).toEqual([[cited.id, 2]])
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
      { tool: 'memory_read', calls: 1, withResults: 1, empty: 0, used: 0 },
      { tool: 'memory_search', calls: 1, withResults: 1, empty: 0, used: 1 },
    ])
    expect(store.thread('3f2a9c1e')?.uses).toBe(1)
    expect(store.usageByDay(7)).toEqual([
      {
        day: '2025-10-09',
        searches: 1,
        searchFound: 1,
        searchEmpty: 0,
        reads: 1,
        readFound: 1,
        readMissing: 0,
        notes: 0,
        cited: 1,
        citations: 1,
        agentCorrected: 0,
        userCorrected: 0,
        digests: 1,
        blockRequests: 0,
      },
    ])
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

  it("totals memory's own calls per day and how its start blocks and citations fare", () => {
    const clock = { now: start }
    const store = open(clock)
    store.recordCost({ kind: 'digest', provider: 'opencode-go-pi', model: 'deepseek-v4.1-flash', input: 1_200, cacheRead: 300, output: 150 })
    store.recordCost({ kind: 'digest', provider: 'opencode-go-pi', model: 'deepseek-v4.1-flash', input: 800, cacheRead: 0, output: 90 })
    store.recordCost({ kind: 'jev', provider: 'typesafe', model: 'jev', input: 420, cacheRead: 0, output: 0 })
    expect(store.costsByDay(7)).toEqual([
      { day: '2025-10-09', kind: 'digest', provider: 'opencode-go-pi', model: 'deepseek-v4.1-flash', calls: 2, input: 2_000, cacheRead: 300, output: 240 },
      { day: '2025-10-09', kind: 'jev', provider: 'typesafe', model: 'jev', calls: 1, input: 420, cacheRead: 0, output: 0 },
    ])
    store.freezeBlock('session-a', 'x'.repeat(900))
    store.freezeBlock('session-b', 'x'.repeat(1_100))
    store.freezeBlock('session-c', '')
    store.bumpDaily('block.requests', 7)
    store.putThread(digest('session-3f2a9c1e', '/p/x', 'Digest'))
    store.recordUse({ kind: 'thread', id: 'session-3f2a9c1e' }, 'session-reader')
    store.recordUse({ kind: 'thread', id: 'session-3f2a9c1e' }, 'session-other')
    expect(store.flagCitations({ thread: 'session-reader', by: 'user', sinceMs: 60_000 })).toBe(1)
    const [latest] = store.recentCitations({ limit: 1 })
    expect(store.rateCitation({ id: latest?.id ?? 0, rating: 'down' })).toBe(true)
    expect(store.effectiveness()).toEqual({
      block: { threads: 2, meanBytes: 1_000, maxBytes: 1_100, requests: 7 },
      citations: { total: 2, agentCorrected: 0, userCorrected: 1, up: 0, down: 1 },
    })
  })
})

describe('scoped retrieval', () => {
  it('keeps in-scope recall when another project dominates the candidate budget', () => {
    const store = open()
    for (let index = 0; index < 300; index += 1) store.addNote(note('noise', `checkpoint checkpoint checkpoint noise ${String(index)}`))
    for (let index = 0; index < 3; index += 1) store.addNote(note('mine', `note ${String(index)} mentions checkpoint once`))

    const hits = store.search({ query: 'checkpoint', projects: ['mine'], limit: 10 })
    // The out-of-project corpus outranks these notes, so a global limit used to consume the whole budget.
    expect(hits.map(hit => hit.project)).toEqual(['mine', 'mine', 'mine'])
  })

  it('still finds every project when no filter is given', () => {
    const store = open()
    store.addNote(note('noise', 'checkpoint noise'))
    store.addNote(note('mine', 'checkpoint mine'))

    const hits = store.search({ query: 'checkpoint', projects: [], limit: 10 })
    expect([...new Set(hits.map(hit => hit.project))].sort()).toEqual(['mine', 'noise'])
  })

  it('scores only the requested projects of the vector index', () => {
    const store = open()
    const noise = store.addNote(note('noise', 'checkpoint noise')).note
    const mine = store.addNote(note('mine', 'checkpoint mine')).note
    store.putEmbedding({ kind: 'note', ref: String(noise.id), project: 'noise', model: 'scoped-model', vector: new Float32Array([1, 0]) })
    store.putEmbedding({ kind: 'note', ref: String(mine.id), project: 'mine', model: 'scoped-model', vector: new Float32Array([0, 1]) })

    const hits = store.search({
      query: 'checkpoint',
      projects: ['mine'],
      limit: 5,
      ranker: 'vector',
      queryVector: new Float32Array([0, 1]),
      embeddingModel: 'scoped-model',
    })
    expect(hits.map(hit => [hit.kind, hit.project])).toEqual([['note', 'mine']])
  })
})

describe('memory store statement reuse', () => {
  it('prepares each SQL text once for the life of the database', () => {
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
    try {
      const store = open()
      for (let index = 0; index < 25; index += 1) {
        store.indexMessages({
          thread: 'session-a',
          project: 'dshfiles',
          throughSeq: index + 1,
          messages: [{ seq: index + 1, role: 'user', text: `checkpoint ${String(index)} before landing`, at: start + index }],
        })
      }
      store.search({ query: 'checkpoint', projects: ['dshfiles'], limit: 5 })

      const prepared = prepare.mock.calls.map(call => String(call[0]))
      const repeated = prepared.filter((sql, index) => prepared.indexOf(sql) !== index)
      expect(repeated).toEqual([])
      // The workload really exercises the reuse: many statements, each compiled once.
      expect(prepared.length).toBeGreaterThan(4)
      store.close()
    } finally {
      prepare.mockRestore()
    }
  })

  it('adds the excerpt column to a database indexed before excerpts were kept', () => {
    const directory = mkdtempSync(join(tmpdir(), 'memory-excerpt-'))
    const path = join(directory, 'memory.db')
    const legacy = new DatabaseSync(path)
    legacy.exec(
      'create table messages (rowid integer primary key, thread text not null, seq integer not null, project text not null, role text not null, at integer not null, unique (thread, seq))',
    )
    legacy.close()

    const store = openMemoryStore({ path })
    store.indexMessages({ thread: 'session-new', project: '/p/x', throughSeq: 1, messages: [{ seq: 1, role: 'user', text: 'INC-200 rollback', at: start }] })
    const hit = store.search({ query: 'rollback', projects: ['/p/x'], ownProject: '/p/x', limit: 5 }).find(entry => entry.kind === 'message')
    expect(hit).toMatchObject({ kind: 'message', excerpt: 'INC-200 rollback' })
    rmSync(directory, { recursive: true, force: true })
  })
})
