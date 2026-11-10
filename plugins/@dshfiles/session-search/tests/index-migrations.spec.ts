import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { expect, it } from 'vitest'

const indexFrom = (sql: SqlClient.SqlClient) => new SearchIndex(sql)
import { indexMigrations, SearchIndex } from '../src/index-db.js'

it('adopts an existing unversioned index without losing its FTS data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-migration-'))
  const filename = join(root, 'index.sqlite')
  try {
    // The unversioned schema the DatabaseSync index wrote, then its rows: the store adds `effect_sql_migrations`
    // without touching these tables.
    const legacy = new DatabaseSync(filename)
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, version INTEGER NOT NULL, created_at INTEGER NOT NULL, cwd TEXT, parent_session TEXT,
        seed_length INTEGER, delegation_depth INTEGER, agent_preset TEXT, log_path TEXT NOT NULL, log_dev TEXT NOT NULL,
        log_ino TEXT NOT NULL, log_offset INTEGER NOT NULL, log_size INTEGER NOT NULL, log_mtime_ns TEXT NOT NULL,
        indexed_at INTEGER NOT NULL, documents_count INTEGER NOT NULL DEFAULT 0, truncated_documents INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE VIRTUAL TABLE session_documents USING fts5(
        text, session_id UNINDEXED, seq UNINDEXED, type UNINDEXED, time UNINDEXED, surface UNINDEXED, truncated UNINDEXED,
        tokenize = 'unicode61'
      );
      CREATE VIRTUAL TABLE conversation_documents USING fts5(
        text, session_id UNINDEXED, seq UNINDEXED, type UNINDEXED, time UNINDEXED, surface UNINDEXED, truncated UNINDEXED,
        tokenize = 'unicode61'
      );
      CREATE TABLE session_document_rows (
        session_id TEXT NOT NULL, document_rowid INTEGER NOT NULL, PRIMARY KEY (session_id, document_rowid)
      ) STRICT;
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT INTO sessions VALUES ('existing', 4, 0, NULL, NULL, NULL, NULL, NULL, 'existing', '1', '1', 1, 1, '1', 1, 1, 0);
      INSERT INTO session_documents (text, session_id, seq, type, time, surface, truncated) VALUES ('quartz migration', 'existing', 1, 'user/message', 1, 'current', 0);
      INSERT INTO conversation_documents (text, session_id, seq, type, time, surface, truncated) VALUES ('quartz migration', 'existing', 1, 'user/message', 1, 'current', 0);
    `)
    legacy.close()
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
      const index = indexFrom(sql)
      yield* index.commitBatch({
        header: { id: 'written', version: 4, createdAt: 0, isSeeded: false },
        cursor: { logPath: 'written', dev: '1', ino: '1', offset: 1, size: 1, mtimeNs: '1' },
        documents: [{ sessionId: 'written', seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'quartz', truncated: false }],
        replace: true,
        now: 1,
      })
      yield* sql`DELETE FROM conversation_documents`
      yield* sql`DELETE FROM session_document_rows`
      const conversationReady = yield* index.backfillConversation(100)
      const rowMapReady = yield* index.backfillRowMap(100)
      const cursor = yield* index.cursor('written')
      const search = yield* index.searchSessions({ query: 'quartz', limit: 5 })
      const find = yield* index.findInSession({ sessionId: 'written', query: 'quartz', limit: 5 })
      const mapped = yield* sql`SELECT session_id FROM conversation_documents WHERE conversation_documents MATCH ${'quartz'}`
      yield* index.forget('written')
      const remaining = yield* sql`SELECT session_id FROM session_documents WHERE session_documents MATCH ${'quartz'}`
      return { cursor, search, find, mapped, remaining, conversationReady, rowMapReady }
    }).pipe(
      Effect.provide(SqliteStore.layer({ filename: ':memory:', migrations: indexMigrations })),
      Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
    ),
  )
  expect(result.conversationReady).toBe(true)
  expect(result.rowMapReady).toBe(true)
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
      const index = indexFrom(sql)
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
