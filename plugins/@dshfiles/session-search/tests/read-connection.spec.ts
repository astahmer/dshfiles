/**
 * The worker's searches read through a second, read-only SQLite connection, so a group commit that still holds the
 * write connection does not queue them. This proves the mechanism on the real store and WAL setup: a read completes
 * while the write transaction is still open, where one shared connection would have waited for its commit.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { Context, Duration, Effect, Layer } from 'effect'
import { Reactivity } from 'effect/reactivity'
import { SqlClient } from 'effect/sql'
import { afterEach, expect, it } from 'vitest'
import { indexMigrations } from '../src/index-db.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

it('answers a read while a group transaction is open on the write connection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-read-connection-'))
  roots.push(root)
  const filename = join(root, 'index.sqlite')

  const outcome = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(SqliteStore.layer({ filename, migrations: indexMigrations }).pipe(Layer.provide(platform)))
        const write = Context.get(context, SqlClient.SqlClient)
        const read = yield* SqliteClient.make({ filename, readonly: true, busyTimeout: Duration.seconds(5) }).pipe(Effect.provide(Reactivity.layer))
        let committed = false
        const transaction = write.withTransaction(
          Effect.gen(function* () {
            yield* write.unsafe("INSERT INTO meta (key, value) VALUES ('probe', '1') ON CONFLICT (key) DO UPDATE SET value = '1'")
            yield* Effect.sleep(Duration.millis(1_000))
            committed = true
          }),
        )
        const during = Effect.gen(function* () {
          yield* Effect.sleep(Duration.millis(150))
          const startedAt = Date.now()
          const rows = yield* read.unsafe('SELECT count(*) AS count FROM sessions')
          return { rows, ms: Date.now() - startedAt, committed }
        })
        const [, observed] = yield* Effect.all([transaction, during], { concurrency: 'unbounded' })
        return observed
      }),
    ),
  )

  expect(outcome.rows).toHaveLength(1)
  expect(outcome.committed).toBe(false)
  expect(outcome.ms).toBeLessThan(800)
}, 30_000)
