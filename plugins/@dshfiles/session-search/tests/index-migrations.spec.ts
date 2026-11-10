import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { expect, it } from 'vitest'
import { EffectSearchIndex, indexMigrations, SearchIndex } from '../src/index-db.js'

it('adopts an existing unversioned index without losing its FTS data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-migration-'))
  const filename = join(root, 'index.sqlite')
  try {
    const index = new SearchIndex(filename)
    index.commitBatch({
      header: { id: 'existing', version: 4, createdAt: 0, isSeeded: false },
      cursor: { logPath: 'existing', dev: '1', ino: '1', offset: 1, size: 1, mtimeNs: '1' },
      documents: [{ sessionId: 'existing', seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'quartz migration', truncated: false }],
      replace: true,
      now: 1,
    })
    index.close()
    const rows = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return yield* sql`SELECT session_id FROM session_documents WHERE session_documents MATCH ${'quartz'}`
      }).pipe(
        Effect.provide(SqliteStore.layer({ filename, migrations: indexMigrations })),
        Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
      ),
    )
    expect(rows).toEqual([{ session_id: 'existing' }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('writes and forgets mapped FTS documents through Effect SQL', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const index = new EffectSearchIndex(sql)
      yield* index.commitBatch({
        header: { id: 'written', version: 4, createdAt: 0, isSeeded: false },
        cursor: { logPath: 'written', dev: '1', ino: '1', offset: 1, size: 1, mtimeNs: '1' },
        documents: [{ sessionId: 'written', seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'quartz', truncated: false }],
        replace: true,
        now: 1,
      })
      const cursor = yield* index.cursor('written')
      const search = yield* index.searchSessions({ query: 'quartz', limit: 5 })
      const find = yield* index.findInSession({ sessionId: 'written', query: 'quartz', limit: 5 })
      const mapped = yield* sql`SELECT session_id FROM conversation_documents WHERE conversation_documents MATCH ${'quartz'}`
      yield* index.forget('written')
      const remaining = yield* sql`SELECT session_id FROM session_documents WHERE session_documents MATCH ${'quartz'}`
      return { cursor, search, find, mapped, remaining }
    }).pipe(
      Effect.provide(SqliteStore.layer({ filename: ':memory:', migrations: indexMigrations })),
      Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
    ),
  )
  expect(result.cursor?.offset).toBe(1)
  expect(result.search.matches.map(match => match.sessionId)).toEqual(['written'])
  expect(result.find.matches.map(match => match.seq)).toEqual([1])
  expect(result.mapped).toEqual([{ session_id: 'written' }])
  expect(result.remaining).toEqual([])
})

it('rolls back grouped Effect index writes and their FTS rows', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const index = new EffectSearchIndex(sql)
      yield* sql.unsafe("CREATE TRIGGER fail_second BEFORE INSERT ON sessions WHEN NEW.id = 'second' BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
      const batch = (id: string) => ({
        header: { id, version: 4, createdAt: 0, isSeeded: false },
        cursor: { logPath: id, dev: '1', ino: '1', offset: 1, size: 1, mtimeNs: '1' },
        documents: [{ sessionId: id, seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'rollbackterm', truncated: false }],
        replace: true,
        now: 1,
      })
      const outcome = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* index.commitBatch(batch('first'))
            yield* index.commitBatch(batch('second'))
          }),
        )
        .pipe(Effect.result)
      const cursor = yield* index.cursor('first')
      const rows = yield* sql`SELECT session_id FROM session_documents WHERE session_documents MATCH ${'rollbackterm'}`
      return { outcome, cursor, rows }
    }).pipe(
      Effect.provide(SqliteStore.layer({ filename: ':memory:', migrations: indexMigrations })),
      Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
    ),
  )
  expect(result.outcome._tag).toBe('Failure')
  expect(result.cursor).toBeUndefined()
  expect(result.rows).toEqual([])
})
