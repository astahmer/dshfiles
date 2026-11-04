import { DatabaseSync } from 'node:sqlite'

import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { TestClock } from 'effect/testing'

import { MemoryDb } from './memory-db.ts'
import { MemoryRepo, type NoteInput, type ThreadDigest } from './memory-repo.ts'

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

const note = (project: string, text: string): NoteInput => ({
  project,
  text,
  category: 'project',
  scope: 'repo',
  confidence: 'stated',
  sourceThread: 'session-a',
  sourceSeq: null,
  origin: 'agent',
})

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)
const repoAt = (filename: string) => MemoryRepo.layer.pipe(Layer.provide(MemoryDb.layer(filename)), Layer.provide(platform))

/** A fresh in-memory store with the clock at `start`. */
const withStore = <A, E>(body: (store: MemoryRepo['Service']) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(start)
    return yield* body(yield* MemoryRepo)
  }).pipe(Effect.provide(repoAt(':memory:')))

const threadIds = (hits: readonly { readonly kind: string; readonly id?: unknown }[]) => hits.map(hit => (hit.kind === 'thread' ? hit.id : ''))

const temporaryFile = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  return path.join(yield* fs.makeTempDirectoryScoped({ prefix: 'memory-repo-' }), 'memory.db')
}).pipe(Effect.provide(platform))

describe('memory repo', () => {
  it.effect('finds exact identifiers by substring and words by stem', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.putThread(digest('session-a', '/p/halyard', 'Northwind Freight account ACC-77341 moved to the Enterprise tier.'))
        yield* store.putThread(digest('session-b', '/p/halyard', 'Rebalancing consumers after the coordinator restarted.'))
        expect(threadIds(yield* store.search({ query: '77341', projects: [], limit: 3 })).at(0)).toBe('session-a')
        expect(threadIds(yield* store.search({ query: 'rebalance consumer', projects: [], limit: 3 })).at(0)).toBe('session-b')
      }),
    ),
  )

  it.effect('stores identical digests and notes once', () =>
    withStore(store =>
      Effect.gen(function* () {
        expect(yield* store.putThread(digest('session-a', '/p/x', 'Same digest'))).toBe('new')
        expect(yield* store.putThread(digest('session-b', '/p/x', 'Same digest'))).toBe('duplicate')
        expect(yield* store.putThread(digest('session-a', '/p/x', 'Same digest'))).toBe('unchanged')
        expect(yield* store.search({ query: 'same digest', projects: [], limit: 5 })).toHaveLength(1)
        const first = yield* store.addNote(note('/p/x', 'Deploys need the ops approval label.'))
        const second = yield* store.addNote(note('/p/x', '  deploys need the OPS approval label. '))
        expect(second).toEqual({ note: first.note, duplicate: true })
        expect((yield* store.usage).notes).toBe(1)
      }),
    ),
  )

  it.effect('rekeys workspace memory rows to their JJ project and is idempotent', () =>
    withStore(store =>
      Effect.gen(function* () {
        const from = '/p/project-threads/thread-a'
        const to = '/p/project'
        const storedNote = (yield* store.addNote(note(from, 'Repository uses a stable checkpoint.'))).note
        yield* store.putThread(digest('session-a', from, 'Workspace digest includes a checkpoint.'))
        yield* store.indexMessages({
          thread: 'session-a',
          project: from,
          throughSeq: 1,
          messages: [{ seq: 1, role: 'user', text: 'Review the checkpoint before landing.', at: start }],
        })
        yield* store.putEmbedding({ kind: 'thread', ref: 'session-a', project: from, model: 'test-model', vector: new Float32Array([0.25, 0.75]) })

        expect(yield* store.projectPaths).toEqual([from])
        expect(yield* store.rekeyProjects({ mappings: [{ from, to }] })).toEqual({
          projects: 1,
          moved: { notes: 1, threads: 1, messages: 1, embeddings: 1, docsWords: 2, docsIds: 2 },
          conflicts: [],
        })
        expect(yield* store.projectPaths).toEqual([to])
        expect((yield* store.note(storedNote.id))?.project).toBe(to)
        expect((yield* store.thread('session-a'))?.project).toBe(to)
        const hits = yield* store.search({ query: 'checkpoint', projects: [to], limit: 10 })
        expect(hits).toHaveLength(3)
        expect(hits.every(hit => hit.project === to)).toBe(true)
        expect((yield* store.rekeyProjects({ mappings: [{ from, to }] })).moved).toEqual({
          notes: 0,
          threads: 0,
          messages: 0,
          embeddings: 0,
          docsWords: 0,
          docsIds: 0,
        })
      }),
    ),
  )

  it.effect('includes invalid note history in project-path backfills', () =>
    withStore(store =>
      Effect.gen(function* () {
        const from = '/p/project-threads/forgotten'
        const to = '/p/project'
        const oldNote = (yield* store.addNote(note(from, 'An obsolete project setting.'))).note
        yield* store.forgetNote({ id: oldNote.id, reason: 'replaced' })
        expect(yield* store.projects).toEqual([])
        expect(yield* store.projectPaths).toEqual([from])
        expect((yield* store.rekeyProjects({ mappings: [{ from, to }] })).moved.notes).toBe(1)
        expect((yield* store.noteHistory(oldNote.id)).map(entry => entry.project)).toEqual([to])
        expect(yield* store.projectPaths).toEqual([to])
      }),
    ),
  )

  it.effect('rejects all project rekeys when source paths collide with each other', () =>
    withStore(store =>
      Effect.gen(function* () {
        const unique = '/p/project-threads/unique'
        const first = '/p/project-threads/first'
        const second = '/p/project-threads/second'
        const to = '/p/project'
        yield* store.putThread(digest('session-unique', unique, 'Unique digest.'))
        yield* store.addNote(note(first, 'Duplicate history across workspaces.'))
        yield* store.addNote(note(second, 'Duplicate history across workspaces.'))
        const result = yield* store.rekeyProjects({
          mappings: [
            { from: unique, to },
            { from: first, to },
            { from: second, to },
          ],
        })
        expect(result.projects).toBe(0)
        expect(result.conflicts).toEqual([{ kind: 'note', target: to, collisions: 1 }])
        expect((yield* store.thread('session-unique'))?.project).toBe(unique)
        expect(yield* store.projectPaths).toEqual([first, second, unique])
      }),
    ),
  )

  it.effect('keeps note and digest collisions separate during project rekeying', () =>
    withStore(store =>
      Effect.gen(function* () {
        const from = '/p/project-threads/thread-a'
        const to = '/p/project'
        const sourceNote = (yield* store.addNote(note(from, 'Shared setup requirement.'))).note
        yield* store.addNote(note(to, 'Shared setup requirement.'))
        yield* store.putThread(digest('session-source', from, 'Same digest.'))
        yield* store.putThread(digest('session-target', to, 'Same digest.'))
        const result = yield* store.rekeyProjects({ mappings: [{ from, to }] })
        expect(result.moved).toEqual({ notes: 0, threads: 0, messages: 0, embeddings: 0, docsWords: 0, docsIds: 0 })
        expect(result.conflicts).toEqual(
          expect.arrayContaining([
            { kind: 'note', target: to, collisions: 1 },
            { kind: 'thread', target: to, collisions: 1 },
          ]),
        )
        expect((yield* store.note(sourceNote.id))?.project).toBe(from)
        expect((yield* store.thread('session-source'))?.project).toBe(from)
      }),
    ),
  )

  it.effect('supersedes a note on update and hides it on forget, keeping the history', () =>
    withStore(store =>
      Effect.gen(function* () {
        const original = (yield* store.addNote(note('/p/x', 'Retention default is 48 hours.'))).note
        const replacement = yield* store.updateNote({
          id: original.id,
          text: 'Retention default is 72 hours.',
          reason: 'changed in 4.2.0',
          sourceThread: 'session-b',
          sourceSeq: 4,
          origin: 'agent',
        })
        expect(replacement?.supersedes).toBe(original.id)
        expect(yield* store.note(original.id)).toBeUndefined()
        const noteIds = (yield* store.search({ query: 'retention default', projects: [], limit: 5 })).map(hit => (hit.kind === 'note' ? hit.id : 0))
        expect(noteIds).toEqual([replacement?.id])
        expect(yield* store.forgetNote({ id: replacement?.id ?? 0, reason: 'no longer relevant' })).toBe(true)
        expect(yield* store.search({ query: 'retention default', projects: [], limit: 5 })).toEqual([])
        expect((yield* store.noteHistory(original.id)).map(entry => [entry.text, entry.valid, entry.reason])).toEqual([
          ['Retention default is 48 hours.', false, 'changed in 4.2.0'],
          ['Retention default is 72 hours.', false, 'no longer relevant'],
        ])
      }),
    ),
  )

  it.effect('archives and restores notes without deleting their stored rows or retrieval indexes', () =>
    withStore(store =>
      Effect.gen(function* () {
        const noteRecord = (yield* store.addNote(note('/p/x', 'The rollout window remains 72 hours.'))).note
        expect(yield* store.archiveNote(noteRecord.id)).toBe(true)
        expect(yield* store.note(noteRecord.id)).toBeUndefined()
        expect(yield* store.listNotes({ project: '/p/x', includeInvalid: true, limit: 10 })).toEqual([])
        expect(yield* store.listNotes({ project: '/p/x', includeInvalid: true, includeArchived: true, limit: 10 })).toMatchObject([
          { id: noteRecord.id, archivedAt: start },
        ])
        expect((yield* store.search({ query: 'rollout window', projects: [], limit: 5 })).filter(hit => hit.kind === 'note')).toEqual([])
        const duplicate = (yield* store.addNote(note('/p/x', 'The rollout window remains 72 hours.'))).note
        expect(yield* store.restoreNote(noteRecord.id)).toBe(false)
        expect(yield* store.archiveNote(duplicate.id)).toBe(true)
        expect(yield* store.restoreNote(noteRecord.id)).toBe(true)
        expect((yield* store.search({ query: 'rollout window', projects: [], limit: 5 })).some(hit => hit.kind === 'note' && hit.id === noteRecord.id)).toBe(
          true,
        )
      }),
    ),
  )

  it.effect('counts notes by lifecycle state and ranks the most-cited valid notes', () =>
    withStore(store =>
      Effect.gen(function* () {
        const cited = (yield* store.addNote(note('/p/x', 'Nightly runs start after the cache warms.'))).note
        const replaced = (yield* store.addNote(note('/p/x', 'Deploys need the ops approval label.'))).note
        const forgotten = (yield* store.addNote(note('/p/x', 'The old canary window is two hours.'))).note
        yield* store.updateNote({
          id: replaced.id,
          text: 'Deploys need the ops-approval label and a green canary.',
          reason: 'tightened',
          sourceThread: null,
          sourceSeq: null,
          origin: 'panel',
        })
        yield* store.forgetNote({ id: forgotten.id, reason: 'obsolete' })
        yield* store.recordUse({ kind: 'note', id: cited.id }, 'session-reader')
        yield* store.recordUse({ kind: 'note', id: cited.id }, 'session-writer')
        expect(yield* store.noteStatusCounts()).toEqual({ active: 2, superseded: 1, forgotten: 1, archived: 0 })
        expect(yield* store.noteStatusCounts('/p/x')).toEqual({ active: 2, superseded: 1, forgotten: 1, archived: 0 })
        expect((yield* store.topNotes(5)).map(entry => [entry.id, entry.uses])).toEqual([[cited.id, 2]])
      }),
    ),
  )

  it.effect('keeps only an index of message text, never the text itself', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.indexMessages({
          thread: 'session-a',
          project: '/p/x',
          throughSeq: 3,
          messages: [{ seq: 2, role: 'user', text: 'Our admin API listens on 9644.', at: start }],
        })
        expect((yield* store.search({ query: '9644', projects: [], limit: 1 }))[0]).toMatchObject({ kind: 'message', thread: 'session-a', seq: 2 })
        expect(yield* store.indexedThrough('session-a')).toBe(3)
        expect(JSON.stringify(yield* store.usage)).not.toContain('9644')
      }),
    ),
  )

  it.effect('drops digests and indexed messages past retention but keeps notes', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.putThread(digest('session-old', '/p/x', 'An old investigation of INC-100.'))
        yield* store.indexMessages({
          thread: 'session-old',
          project: '/p/x',
          throughSeq: 1,
          messages: [{ seq: 1, role: 'user', text: 'INC-100 details', at: start }],
        })
        yield* store.addNote(note('/p/x', 'INC-100 was caused by a config push.'))
        yield* TestClock.setTime(start + 400 * day)
        yield* store.putThread(digest('session-new', '/p/x', 'A new thread about INC-200.', start + 400 * day))
        expect(yield* store.prune(365)).toEqual({ threads: 1, messages: 1 })
        expect(yield* store.thread('session-old')).toBeUndefined()
        expect((yield* store.search({ query: 'INC-100', projects: [], limit: 5 })).flatMap(hit => (hit.kind === 'thread' ? [] : [hit.kind]))).toEqual(['note'])
        expect(yield* store.thread('session-new')).toBeDefined()
      }),
    ),
  )

  it.effect('counts a citation as use of the tool call that returned the id and of the cited item', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.putThread(digest('session-3f2a9c1e', '/p/x', 'Digest'))
        yield* store.recordToolCall({ thread: 'session-reader', tool: 'memory_search', results: 1, ids: ['t:3f2a9c1e'] })
        yield* store.recordToolCall({ thread: 'session-reader', tool: 'memory_read', results: 1, ids: ['n:9'] })
        expect(yield* store.markCited({ thread: 'session-reader', cited: ['t:3f2a9c1e'], sinceMs: 60_000 })).toBe(1)
        yield* store.recordUse({ kind: 'thread', id: 'session-3f2a9c1e' }, 'session-reader')
        expect((yield* store.usage).tools).toEqual([
          { tool: 'memory_read', calls: 1, withResults: 1, empty: 0, used: 0 },
          { tool: 'memory_search', calls: 1, withResults: 1, empty: 0, used: 1 },
        ])
        expect((yield* store.thread('3f2a9c1e'))?.uses).toBe(1)
        expect(yield* store.usageByDay(7)).toEqual([
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
      }),
    ),
  )

  it.effect('ranks the caller project first and keeps old exact matches findable', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.putThread(digest('session-other', '/p/other', 'Kafka partition lag alert thresholds.'))
        yield* store.putThread(digest('session-own', '/p/own', 'Kafka partition lag alert thresholds for Halyard.'))
        yield* store.putThread(digest('session-ancient', '/p/own', 'The broker id for staging is BRK-4471.', start - 300 * day))
        const hits = yield* store.search({ query: 'partition lag alert', projects: [], ownProject: '/p/own', limit: 2 })
        expect(hits.map(hit => hit.project)).toEqual(['/p/own', '/p/other'])
        expect(threadIds(yield* store.search({ query: 'BRK-4471', projects: [], ownProject: '/p/own', limit: 1 }))).toEqual(['session-ancient'])
      }),
    ),
  )

  it.effect("totals memory's own calls per day and how its start blocks and citations fare", () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.recordCost({ kind: 'digest', provider: 'opencode-go-pi', model: 'deepseek-v4.1-flash', input: 1_200, cacheRead: 300, output: 150 })
        yield* store.recordCost({ kind: 'digest', provider: 'opencode-go-pi', model: 'deepseek-v4.1-flash', input: 800, cacheRead: 0, output: 90 })
        yield* store.recordCost({ kind: 'jev', provider: 'typesafe', model: 'jev', input: 420, cacheRead: 0, output: 0 })
        expect(yield* store.costsByDay(7)).toEqual([
          { day: '2025-10-09', kind: 'digest', provider: 'opencode-go-pi', model: 'deepseek-v4.1-flash', calls: 2, input: 2_000, cacheRead: 300, output: 240 },
          { day: '2025-10-09', kind: 'jev', provider: 'typesafe', model: 'jev', calls: 1, input: 420, cacheRead: 0, output: 0 },
        ])
        yield* store.freezeBlock('session-a', 'x'.repeat(900))
        yield* store.freezeBlock('session-b', 'x'.repeat(1_100))
        yield* store.freezeBlock('session-c', '')
        yield* store.bumpDaily('block.requests', 7)
        yield* store.putThread(digest('session-3f2a9c1e', '/p/x', 'Digest'))
        yield* store.recordUse({ kind: 'thread', id: 'session-3f2a9c1e' }, 'session-reader')
        yield* store.recordUse({ kind: 'thread', id: 'session-3f2a9c1e' }, 'session-other')
        expect(yield* store.flagCitations({ thread: 'session-reader', by: 'user', sinceMs: 60_000 })).toBe(1)
        const [latest] = yield* store.recentCitations({ limit: 1 })
        expect(yield* store.rateCitation({ id: latest?.id ?? 0, rating: 'down' })).toBe(true)
        expect(yield* store.effectiveness).toEqual({
          block: { threads: 2, meanBytes: 1_000, maxBytes: 1_100, requests: 7 },
          citations: { total: 2, agentCorrected: 0, userCorrected: 1, up: 0, down: 1 },
        })
      }),
    ),
  )

  it.effect('serves a frozen block once and counts it once', () =>
    withStore(store =>
      Effect.gen(function* () {
        expect(yield* store.freezeBlock('session-a', 'first')).toBe('first')
        expect(yield* store.freezeBlock('session-a', 'second')).toBe('first')
        expect((yield* store.usage).counters['blocks.served']).toBe(1)
        expect(yield* store.version).toBe(0)
        yield* store.addNote(note('/p/x', 'Bumps the version.'))
        expect(yield* store.version).toBe(1)
      }),
    ),
  )
})

describe('scoped retrieval', () => {
  it.effect('keeps in-scope recall when another project dominates the candidate budget', () =>
    withStore(store =>
      Effect.gen(function* () {
        for (let index = 0; index < 300; index += 1) yield* store.addNote(note('noise', `checkpoint checkpoint checkpoint noise ${String(index)}`))
        for (let index = 0; index < 3; index += 1) yield* store.addNote(note('mine', `note ${String(index)} mentions checkpoint once`))
        // The out-of-project corpus outranks these notes, so a global limit used to consume the whole budget.
        expect((yield* store.search({ query: 'checkpoint', projects: ['mine'], limit: 10 })).map(hit => hit.project)).toEqual(['mine', 'mine', 'mine'])
      }),
    ),
  )

  it.effect('still finds every project when no filter is given', () =>
    withStore(store =>
      Effect.gen(function* () {
        yield* store.addNote(note('noise', 'checkpoint noise'))
        yield* store.addNote(note('mine', 'checkpoint mine'))
        const hits = yield* store.search({ query: 'checkpoint', projects: [], limit: 10 })
        expect([...new Set(hits.map(hit => hit.project))].sort()).toEqual(['mine', 'noise'])
      }),
    ),
  )

  it.effect('scores only the requested projects of the vector index', () =>
    withStore(store =>
      Effect.gen(function* () {
        const noise = (yield* store.addNote(note('noise', 'checkpoint noise'))).note
        const mine = (yield* store.addNote(note('mine', 'checkpoint mine'))).note
        yield* store.putEmbedding({ kind: 'note', ref: String(noise.id), project: 'noise', model: 'scoped-model', vector: new Float32Array([1, 0]) })
        yield* store.putEmbedding({ kind: 'note', ref: String(mine.id), project: 'mine', model: 'scoped-model', vector: new Float32Array([0, 1]) })
        const hits = yield* store.search({
          query: 'checkpoint',
          projects: ['mine'],
          limit: 5,
          ranker: 'vector',
          queryVector: new Float32Array([0, 1]),
          embeddingModel: 'scoped-model',
        })
        expect(hits.map(hit => [hit.kind, hit.project])).toEqual([['note', 'mine']])
      }),
    ),
  )
})

describe('memory store migrations', () => {
  it.effect('migrates legacy notes to a distinct archive column before building the active-note index', () =>
    Effect.gen(function* () {
      const filename = yield* temporaryFile
      const legacy = new DatabaseSync(filename)
      legacy.exec(
        "create table notes (id integer primary key, project text not null, scope text not null, category text not null, confidence text not null, text text not null, hash text not null, source_thread text, source_seq integer, origin text not null default 'agent', first_created_at integer not null default 0, created_at integer not null, valid integer not null default 1, supersedes integer, superseded_by integer, forgotten_at integer, reason text, uses integer not null default 0, last_used_at integer); create unique index notes_valid_hash on notes (project, hash) where valid = 1",
      )
      legacy.close()
      yield* Effect.scoped(Layer.build(repoAt(filename)))
      const database = new DatabaseSync(filename)
      expect(
        database
          .prepare("select name from pragma_table_info('notes')")
          .all()
          .map(row => row['name']),
      ).toContain('archived_at')
      expect(database.prepare("select name from sqlite_master where type = 'index' and name = 'notes_active_hash'").get()).toBeDefined()
      expect(database.prepare("select name from sqlite_master where type = 'index' and name = 'notes_valid_hash'").get()).toBeUndefined()
      database.close()
    }).pipe(Effect.scoped),
  )

  it.effect('adds the excerpt column to a database indexed before excerpts were kept', () =>
    Effect.gen(function* () {
      const filename = yield* temporaryFile
      const legacy = new DatabaseSync(filename)
      legacy.exec(
        'create table messages (rowid integer primary key, thread text not null, seq integer not null, project text not null, role text not null, at integer not null, unique (thread, seq))',
      )
      legacy.close()
      const hit = yield* Effect.gen(function* () {
        const store = yield* MemoryRepo
        yield* store.indexMessages({
          thread: 'session-new',
          project: '/p/x',
          throughSeq: 1,
          messages: [{ seq: 1, role: 'user', text: 'INC-200 rollback', at: start }],
        })
        return (yield* store.search({ query: 'rollback', projects: ['/p/x'], ownProject: '/p/x', limit: 5 })).find(entry => entry.kind === 'message')
      }).pipe(Effect.provide(repoAt(filename)))
      expect(hit).toMatchObject({ kind: 'message', excerpt: 'INC-200 rollback' })
    }).pipe(Effect.scoped),
  )

  it.effect('adopts a file the old opener wrote without losing rows, and reopens it without re-running migrations', () =>
    Effect.gen(function* () {
      const filename = yield* temporaryFile
      yield* Effect.gen(function* () {
        yield* (yield* MemoryRepo).addNote(note('/p/x', 'Survives a reopen.'))
      }).pipe(Effect.provide(repoAt(filename)))
      const reopened = yield* Effect.gen(function* () {
        return yield* (yield* MemoryRepo).listNotes({ limit: 10 })
      }).pipe(Effect.provide(repoAt(filename)))
      expect(reopened.map(entry => entry.text)).toEqual(['Survives a reopen.'])
      const database = new DatabaseSync(filename)
      expect(
        database
          .prepare('select name from effect_sql_migrations order by migration_id')
          .all()
          .map(row => row['name']),
      ).toEqual(['initial_schema', 'message_excerpt', 'note_archive', 'active_note_hash'])
      database.close()
    }).pipe(Effect.scoped),
  )

  it.effect('reports memory as off instead of failing activation when the file cannot be opened', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip((yield* MemoryRepo).usage)
      expect(failure._tag).toBe('MemoryInactive')
    }).pipe(Effect.provide(repoAt('/dev/null/memory.db'))),
  )
})
