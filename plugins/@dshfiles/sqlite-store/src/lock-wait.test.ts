import { DatabaseSync } from 'node:sqlite'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans, type SpanRecorder } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Fiber, FileSystem, Layer, Path } from 'effect'
import { SqlClient } from 'effect/sql'
import { SqliteStore } from './sqlite-store.ts'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const migrations = {
  '1_items': Effect.asVoid(Effect.flatMap(SqlClient.SqlClient, sql => sql.unsafe('CREATE TABLE items (id INTEGER PRIMARY KEY)'))),
}

const scratchFile = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'sqlite-store-lock-' })
    return path.join(directory, name)
  })

const stopRecording = (recorder: SpanRecorder) => Effect.sync(() => recorder.stop())

const lockWaits = (recorder: SpanRecorder) => recorder.named('sqlite lock wait')

describe('SqliteStore lock waits', () => {
  it.live('records a span when a transaction waits for the connection another transaction holds', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        stopRecording,
      )
      const filename = yield* scratchFile('queued.db')
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const holder = yield* Effect.forkChild(sql.withTransaction(Effect.andThen(sql`INSERT INTO items (id) VALUES (1)`, Effect.sleep('120 millis'))))
        yield* Effect.sleep('10 millis')
        yield* sql.withTransaction(sql`INSERT INTO items (id) VALUES (2)`)
        yield* Fiber.join(holder)
        yield* sql.withTransaction(sql`INSERT INTO items (id) VALUES (3)`)
      }).pipe(Effect.provide(SqliteStore.layer({ filename, migrations })), Effect.provide(DshxEffect.tracerLayer))

      // The queued transaction waits about 110 ms; a loaded machine can make another one wait past 50 ms too.
      const waits = recorder.named('sqlite lock wait')
      expect(waits.length).toBeGreaterThanOrEqual(1)
      expect(waits.every(wait => wait.attributes['db.namespace'] === 'queued.db')).toBe(true)
      expect(Math.max(...waits.map(wait => Number(wait.attributes['db.sqlite.lock_wait_ms'])))).toBeGreaterThanOrEqual(100)
    }).pipe(Effect.provide(platform)),
  )

  it.live('records a failed span when another connection holds the write lock past the busy timeout', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        stopRecording,
      )
      const filename = yield* scratchFile('busy.db')
      const exit = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const other = yield* Effect.acquireRelease(
          Effect.sync(() => {
            const database = new DatabaseSync(filename)
            database.exec('BEGIN IMMEDIATE')
            return database
          }),
          database => Effect.sync(() => database.close()),
        )
        expect(other.isOpen).toBe(true)
        return yield* Effect.exit(sql.withTransaction(sql`INSERT INTO items (id) VALUES (1)`))
      }).pipe(Effect.provide(SqliteStore.layer({ filename, migrations, pragmas: { busyTimeout: '150 millis' } })), Effect.provide(DshxEffect.tracerLayer))

      expect(Exit.isFailure(exit)).toBe(true)
      const failed = lockWaits(recorder).filter(wait => wait.status.code === 'error')
      expect(failed).toHaveLength(1)
      expect(failed[0]?.attributes['db.sqlite.lock_wait_ms']).toBeGreaterThanOrEqual(140)
    }).pipe(Effect.provide(platform)),
  )

  it.live('records nothing for a transaction that starts at once, or with the span turned off', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        stopRecording,
      )
      const filename = yield* scratchFile('quiet.db')
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const holder = yield* Effect.forkChild(sql.withTransaction(Effect.andThen(sql`INSERT INTO items (id) VALUES (1)`, Effect.sleep('120 millis'))))
        yield* Effect.sleep('10 millis')
        yield* sql.withTransaction(sql`INSERT INTO items (id) VALUES (2)`)
        yield* Fiber.join(holder)
      }).pipe(Effect.provide(SqliteStore.layer({ filename, migrations, lockWaitSpanMs: 0 })), Effect.provide(DshxEffect.tracerLayer))

      expect(lockWaits(recorder)).toEqual([])
    }).pipe(Effect.provide(platform)),
  )
})
