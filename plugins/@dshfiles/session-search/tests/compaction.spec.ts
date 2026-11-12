/**
 * A compaction rewrites the whole index (optimize + VACUUM, about twice the file in disk writes). It must run once on
 * real garbage and then stay quiet across passes and Host restarts, including an index whose long documents keep it
 * above the bytes-per-document bar right after compacting.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { Context, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'
import { afterEach, expect, it } from 'vitest'
import { indexMigrations, SearchIndex } from '../src/index-db.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)
const hour = 60 * 60_000

const withStore = <A>(filename: string, use: (input: { sql: SqlClient.SqlClient; index: SearchIndex }) => Effect.Effect<A, unknown>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(SqliteStore.layer({ filename, migrations: indexMigrations }).pipe(Layer.provide(platform)))
        const sql = Context.get(context, SqlClient.SqlClient)
        return yield* use({ sql, index: new SearchIndex(sql, filename) })
      }),
    ).pipe(Effect.orDie),
  )

it('compacts a dense index once, then not again on later passes or after a restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-compaction-'))
  roots.push(root)
  const filename = join(root, 'index.sqlite')
  const startedAt = Date.UTC(2026, 10, 12, 12)

  const firstHost = await withStore(filename, ({ sql, index }) =>
    Effect.gen(function* () {
      yield* sql.unsafe(
        `INSERT INTO sessions (id, version, created_at, log_path, log_dev, log_ino, log_offset, log_size, log_mtime_ns, indexed_at, documents_count)
         VALUES ('session-a', 1, 0, '/a.jsonl', '1', '1', 0, 0, '0', 0, 4)`,
      )
      yield* sql.unsafe("INSERT INTO meta (key, value) VALUES ('padding', ?)", ['x'.repeat(256 * 1024)])
      return {
        first: yield* index.compactIfDue(startedAt),
        withinTheHour: yield* index.compactIfDue(startedAt + hour / 2),
        nextHour: yield* index.compactIfDue(startedAt + 2 * hour),
      }
    }),
  )
  const afterRestart = await withStore(filename, ({ index }) => index.compactIfDue(startedAt + 3 * hour))

  expect(firstHost).toEqual({ first: true, withinTheHour: false, nextHour: false })
  expect(afterRestart).toBe(false)
})

it('compacts again once the index has grown well past its last compacted density', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-compaction-'))
  roots.push(root)
  const filename = join(root, 'index.sqlite')
  const startedAt = Date.UTC(2026, 10, 12, 12)

  const outcome = await withStore(filename, ({ sql, index }) =>
    Effect.gen(function* () {
      yield* sql.unsafe(
        `INSERT INTO sessions (id, version, created_at, log_path, log_dev, log_ino, log_offset, log_size, log_mtime_ns, indexed_at, documents_count)
         VALUES ('session-a', 1, 0, '/a.jsonl', '1', '1', 0, 0, '0', 0, 4)`,
      )
      yield* sql.unsafe("INSERT INTO meta (key, value) VALUES ('padding', ?)", ['x'.repeat(256 * 1024)])
      const first = yield* index.compactIfDue(startedAt)
      yield* sql.unsafe("INSERT INTO meta (key, value) VALUES ('more-padding', ?)", ['y'.repeat(512 * 1024)])
      return { first, grown: yield* index.compactIfDue(startedAt + 2 * hour) }
    }),
  )

  expect(outcome).toEqual({ first: true, grown: true })
})
