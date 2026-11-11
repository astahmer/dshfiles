import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans, type SpanRecorder } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { TestClock } from 'effect/testing'
import { SqlClient } from 'effect/sql'
import { SqliteStore } from './sqlite-store.ts'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const migrations = {
  '1_blobs': Effect.asVoid(
    Effect.flatMap(SqlClient.SqlClient, sql => sql.unsafe('CREATE TABLE IF NOT EXISTS blobs (id INTEGER PRIMARY KEY, body BLOB NOT NULL)')),
  ),
}

const scratchFile = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'sqlite-store-space-' })
    return path.join(directory, name)
  })

/** About 2 MiB of rows, then deleted: the pages stay in the file as its freelist. */
const fillAndDelete = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql.withTransaction(
    Effect.forEach(
      Array.from({ length: 64 }, (_, index) => index),
      id => sql`INSERT INTO blobs (id, body) VALUES (${id}, zeroblob(32768))`,
    ),
  )
  yield* sql`DELETE FROM blobs`
  yield* sql.unsafe('PRAGMA wal_checkpoint(TRUNCATE)')
})

const space = Effect.flatMap(SqlClient.SqlClient, sql => SqliteStore.space(sql))

const stopRecording = (recorder: SpanRecorder) => Effect.sync(() => recorder.stop())

describe('SqliteStore space', () => {
  it.effect('creates new files with incremental auto_vacuum', () =>
    Effect.gen(function* () {
      const filename = yield* scratchFile('fresh.db')
      const observed = yield* space.pipe(Effect.provide(SqliteStore.layer({ filename, migrations })))

      expect(observed.autoVacuum).toBe('incremental')
    }).pipe(Effect.provide(platform)),
  )

  it.effect('leaves an existing file in its auto_vacuum mode', () =>
    Effect.gen(function* () {
      const filename = yield* scratchFile('existing.db')
      yield* Effect.flatMap(SqlClient.SqlClient, sql => sql.unsafe('CREATE TABLE blobs (id INTEGER PRIMARY KEY, body BLOB NOT NULL)')).pipe(
        Effect.provide(SqliteClient.layer({ filename })),
      )

      const observed = yield* space.pipe(Effect.provide(SqliteStore.layer({ filename, migrations })))

      expect(observed.autoVacuum).toBe('none')
    }).pipe(Effect.provide(platform)),
  )

  it.effect('reclaim converts an existing file with one VACUUM and reports the bytes freed', () =>
    Effect.gen(function* () {
      const filename = yield* scratchFile('convert.db')
      yield* Effect.flatMap(SqlClient.SqlClient, sql => sql.unsafe('CREATE TABLE blobs (id INTEGER PRIMARY KEY, body BLOB NOT NULL)')).pipe(
        Effect.provide(SqliteClient.layer({ filename })),
      )

      const result = yield* Effect.gen(function* () {
        yield* fillAndDelete
        return yield* SqliteStore.reclaim(yield* SqlClient.SqlClient)
      }).pipe(Effect.provide(SqliteStore.layer({ filename, migrations })))

      expect(result.method).toBe('vacuum')
      expect(result.before.autoVacuum).toBe('none')
      expect(result.before.freePages).toBeGreaterThan(400)
      expect(result.after).toMatchObject({ autoVacuum: 'incremental', freePages: 0 })
      expect(result.bytesFreed).toBe(result.before.bytes - result.after.bytes)
      // The converted file gains a pointer-map page, so slightly less than the whole freelist comes back.
      expect(result.bytesFreed).toBeGreaterThan(result.before.freeBytes - 4 * result.before.pageSize)
    }).pipe(Effect.provide(platform)),
  )

  it.effect('reclaim on an incremental file frees every free page without a VACUUM', () =>
    Effect.gen(function* () {
      const filename = yield* scratchFile('incremental.db')
      const result = yield* Effect.gen(function* () {
        yield* fillAndDelete
        return yield* SqliteStore.reclaim(yield* SqlClient.SqlClient)
      }).pipe(Effect.provide(SqliteStore.layer({ filename, migrations, idleVacuum: false })))

      expect(result.method).toBe('incremental-vacuum')
      expect(result.after.freePages).toBe(0)
      expect(result.bytesFreed).toBe(result.before.freeBytes)
    }).pipe(Effect.provide(platform)),
  )

  it.effect('the idle pass returns at most its page budget per tick and records a span', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        stopRecording,
      )
      const filename = yield* scratchFile('idle.db')
      const observed = yield* Effect.gen(function* () {
        yield* fillAndDelete
        const before = (yield* space).freePages
        yield* TestClock.adjust('59 seconds')
        const untouched = (yield* space).freePages
        yield* TestClock.adjust('1 second')
        const afterOne = (yield* space).freePages
        return { before, untouched, afterOne }
      }).pipe(
        Effect.provide(SqliteStore.layer({ filename, migrations, idleVacuum: { every: '1 minute', pages: 100 } })),
        Effect.provide(DshxEffect.tracerLayer),
      )

      expect(observed.untouched).toBe(observed.before)
      expect(observed.afterOne).toBe(observed.before - 100)
      expect(recorder.span('sqlite-store incremental vacuum').attributes['db.sqlite.pages_freed']).toBe(100)
    }).pipe(Effect.provide(platform)),
  )
})
