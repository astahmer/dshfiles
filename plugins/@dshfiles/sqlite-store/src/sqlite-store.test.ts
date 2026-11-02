import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans, type SpanRecorder } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, FileSystem, Layer, Path, Schema } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'
import { SqliteStore } from './sqlite-store.ts'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const migration = (statement: string) => Effect.asVoid(Effect.flatMap(SqlClient.SqlClient, sql => sql.unsafe(statement)))

const itemsMigrations = {
  '1_create_items': migration('CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL)'),
  '2_add_note': migration('ALTER TABLE items ADD COLUMN note TEXT'),
}

const tableRow = Schema.Struct({ name: Schema.String })
const migrationRow = Schema.Struct({ migration_id: Schema.Int, name: Schema.String })
const userVersionRow = Schema.Struct({ user_version: Schema.Int })

const tableNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* SqlSchema.findAll({
    Request: Schema.Void,
    Result: tableRow,
    execute: () => sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  })(undefined)
  return rows.map(row => row.name)
})

const recordedMigrations = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* SqlSchema.findAll({
    Request: Schema.Void,
    Result: migrationRow,
    execute: () => sql`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`,
  })(undefined)
})

const userVersion = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const row = yield* SqlSchema.findOne({ Request: Schema.Void, Result: userVersionRow, execute: () => sql`PRAGMA user_version` })(undefined)
  return row.user_version
})

const scratchFile = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'sqlite-store-' })
    return path.join(directory, 'nested', 'store', name)
  })

const legacyFile = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const filename = yield* scratchFile(name)
    yield* fs.makeDirectory(path.dirname(filename), { recursive: true })
    return filename
  })

const rawSqlite = (filename: string) => SqliteClient.layer({ filename })

const modeOf = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const info = yield* fs.stat(file)
    return info.mode & 0o777
  })

const stopRecording = (recorder: SpanRecorder) => Effect.sync(() => recorder.stop())

const statementSpans = (recorder: SpanRecorder) => recorder.spans.filter(span => span.attributes['db.query.text'] !== undefined)

describe('SqliteStore', () => {
  it.effect('migrates a fresh file into a private directory with private sidecars', () =>
    Effect.gen(function* () {
      const filename = yield* scratchFile('fresh.db')
      const path = yield* Path.Path
      const observed = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO items (label, note) VALUES (${'first'}, ${'kept'})`
        return {
          tables: yield* tableNames,
          migrations: yield* recordedMigrations,
          modes: yield* Effect.forEach([filename, `${filename}-wal`, `${filename}-shm`], modeOf),
          directoryMode: yield* modeOf(path.dirname(filename)),
          journalMode: yield* sql`PRAGMA journal_mode`,
          synchronous: yield* sql`PRAGMA synchronous`,
          busyTimeout: yield* sql`PRAGMA busy_timeout`,
        }
      }).pipe(Effect.provide(SqliteStore.layer({ filename, migrations: itemsMigrations })))

      expect(observed.tables).toEqual(['effect_sql_migrations', 'items'])
      expect(observed.migrations).toEqual([
        { migration_id: 1, name: 'create_items' },
        { migration_id: 2, name: 'add_note' },
      ])
      expect(observed.modes).toEqual([0o600, 0o600, 0o600])
      expect(observed.directoryMode).toBe(0o700)
      expect(observed.journalMode).toEqual([{ journal_mode: 'wal' }])
      expect(observed.synchronous).toEqual([{ synchronous: 1 }])
      expect(observed.busyTimeout).toEqual([{ timeout: 5000 }])
    }).pipe(Effect.provide(platform)),
  )

  it.effect('adopts a legacy user_version without re-running its migrations', () =>
    Effect.gen(function* () {
      const filename = yield* legacyFile('legacy.db')
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL)`
        yield* sql`INSERT INTO items (label) VALUES (${'legacy row'})`
        yield* sql`PRAGMA user_version = 1`
      }).pipe(Effect.provide(rawSqlite(filename)))

      const observed = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return {
          rows: yield* sql`SELECT label, note FROM items`,
          migrations: yield* recordedMigrations,
          userVersion: yield* userVersion,
        }
      }).pipe(Effect.provide(SqliteStore.layer({ filename, migrations: itemsMigrations, legacyUserVersion: 2 })))

      expect(observed.rows).toEqual([{ label: 'legacy row', note: null }])
      expect(observed.migrations.map(row => row.migration_id)).toEqual([1, 2])
      expect(observed.userVersion).toBe(2)
    }).pipe(Effect.provide(platform)),
  )

  it.effect('refuses a legacy user_version newer than this build knows', () =>
    Effect.gen(function* () {
      const filename = yield* legacyFile('newer-legacy.db')
      yield* Effect.provide(
        Effect.flatMap(SqlClient.SqlClient, sql => sql`PRAGMA user_version = 3`),
        rawSqlite(filename),
      )

      const error = yield* Effect.flip(Effect.provide(Effect.void, SqliteStore.layer({ filename, migrations: itemsMigrations, legacyUserVersion: 2 })))

      expect(error._tag).toBe('SqliteStoreVersionUnsupported')
      expect(error).toMatchObject({ source: 'user-version', foundVersion: 3, supportedVersion: 2 })
    }).pipe(Effect.provide(platform)),
  )

  it.effect('refuses a file migrated by a newer build', () =>
    Effect.gen(function* () {
      const filename = yield* scratchFile('newer.db')
      yield* Effect.provide(Effect.void, SqliteStore.layer({ filename, migrations: itemsMigrations }))

      const error = yield* Effect.flip(
        Effect.provide(Effect.void, SqliteStore.layer({ filename, migrations: { '1_create_items': itemsMigrations['1_create_items'] } })),
      )

      expect(error).toMatchObject({ _tag: 'SqliteStoreVersionUnsupported', source: 'migrations', foundVersion: 2, supportedVersion: 1 })
    }).pipe(Effect.provide(platform)),
  )

  it.effect('rolls back the whole pending batch when a migration fails', () =>
    Effect.gen(function* () {
      const filename = yield* scratchFile('rollback.db')
      yield* Effect.provide(Effect.void, SqliteStore.layer({ filename, migrations: { '1_create_items': itemsMigrations['1_create_items'] } }))

      const error = yield* Effect.flip(
        Effect.provide(
          Effect.void,
          SqliteStore.layer({
            filename,
            migrations: {
              ...itemsMigrations,
              '3_create_audit': migration('CREATE TABLE audit (id INTEGER PRIMARY KEY)'),
              '4_broken': migration('INSERT INTO missing_table VALUES (1)'),
            },
          }),
        ),
      )
      const observed = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return { tables: yield* tableNames, migrations: yield* recordedMigrations, columns: yield* sql`SELECT name FROM pragma_table_info('items')` }
      }).pipe(Effect.provide(rawSqlite(filename)))

      expect(error).toMatchObject({ _tag: 'SqliteMigrationFailed', kind: 'Failed' })
      expect(observed.tables).toEqual(['effect_sql_migrations', 'items'])
      expect(observed.migrations.map(row => row.migration_id)).toEqual([1])
      expect(observed.columns).toEqual([{ name: 'id' }, { name: 'label' }])
    }).pipe(Effect.provide(platform)),
  )

  it.effect('serializes two stores migrating the same file at once', () =>
    Effect.gen(function* () {
      const filename = yield* scratchFile('shared.db')
      const open = Effect.provide(recordedMigrations, SqliteStore.layer({ filename, migrations: itemsMigrations }))

      const [first, second] = yield* Effect.all([open, open], { concurrency: 'unbounded' })

      expect(first.map(row => row.migration_id)).toEqual([1, 2])
      expect(second).toEqual(first)
    }).pipe(Effect.provide(platform)),
  )

  it.effect('emits no statement spans by default while keeping the caller span', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        stopRecording,
      )
      const work = Effect.fn('items write')(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO items (label) VALUES (${'one'})`
        yield* sql`SELECT ${sql`label`} FROM items`
        yield* sql`SELECT 1 AS one`.values
        yield* sql`SELECT 1 AS one`.raw
        yield* sql`SELECT 1 AS one`.withoutTransform
        yield* sql.unsafe('SELECT 1 AS one').unprepared
        yield* sql.withTransaction(sql`UPDATE items SET note = ${'tx'}`)
      })
      yield* work().pipe(Effect.provide(SqliteStore.layer({ filename: ':memory:', migrations: itemsMigrations })), Effect.provide(DshxEffect.tracerLayer))

      expect(statementSpans(recorder)).toEqual([])
      expect(recorder.span('items write').name).toBe('items write')
      expect(recorder.span('sqlite-store open').name).toBe('sqlite-store open')
      expect(recorder.named(/^Migrator /).map(span => span.name)).toEqual(['Migrator 1_create_items', 'Migrator 2_add_note'])
    }).pipe(Effect.provide(platform)),
  )

  it.effect('emits statement spans when a store opts in', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        stopRecording,
      )
      yield* Effect.flatMap(SqlClient.SqlClient, sql => sql`SELECT 1 AS one`).pipe(
        Effect.provide(SqliteStore.layer({ filename: ':memory:', migrations: itemsMigrations, statementSpans: true })),
        Effect.provide(DshxEffect.tracerLayer),
      )

      expect(statementSpans(recorder).map(span => span.attributes['db.query.text'])).toContain('SELECT 1 AS one')
    }).pipe(Effect.provide(platform)),
  )

  it.effect('serves two databases from one layer under their own keys', () =>
    Effect.gen(function* () {
      class SpanDatabase extends Context.Service<SpanDatabase, SqlClient.SqlClient>()('test/SpanDatabase') {}
      class AlertDatabase extends Context.Service<AlertDatabase, SqlClient.SqlClient>()('test/AlertDatabase') {}
      const spansFile = yield* scratchFile('spans.db')
      const alertsFile = yield* scratchFile('alerts.db')
      const databases = Layer.mergeAll(
        SqliteStore.layerAs(SpanDatabase, { filename: spansFile, migrations: { '1_spans': migration('CREATE TABLE spans (id TEXT PRIMARY KEY)') } }),
        SqliteStore.layerAs(AlertDatabase, { filename: alertsFile, migrations: { '1_rules': migration('CREATE TABLE rules (id TEXT PRIMARY KEY)') } }),
      )

      const observed = yield* Effect.gen(function* () {
        const spans = yield* SpanDatabase
        const alerts = yield* AlertDatabase
        yield* spans`INSERT INTO spans (id) VALUES (${'span-1'})`
        yield* alerts`INSERT INTO rules (id) VALUES (${'rule-1'})`
        return {
          spanTables: yield* Effect.provideService(tableNames, SqlClient.SqlClient, spans),
          alertTables: yield* Effect.provideService(tableNames, SqlClient.SqlClient, alerts),
          rule: yield* alerts`SELECT id FROM rules`,
        }
      }).pipe(Effect.provide(databases))

      expect(observed.spanTables).toEqual(['effect_sql_migrations', 'spans'])
      expect(observed.alertTables).toEqual(['effect_sql_migrations', 'rules'])
      expect(observed.rule).toEqual([{ id: 'rule-1' }])
    }).pipe(Effect.provide(platform)),
  )

  it.effect('round-trips rows through SqlSchema on an in-memory store', () =>
    Effect.gen(function* () {
      const Item = Schema.Struct({ id: Schema.Int, label: Schema.String, tags: Schema.fromJsonString(Schema.Array(Schema.String)) })
      const items = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const insert = SqlSchema.void({ Request: Item, execute: row => sql`INSERT INTO tagged ${sql.insert(row)}` })
        const byLabel = SqlSchema.findAll({
          Request: Schema.String,
          Result: Item,
          execute: label => sql`SELECT id, label, tags FROM tagged WHERE label = ${label}`,
        })
        yield* insert({ id: 1, label: 'kept', tags: ['a', 'b'] })
        yield* insert({ id: 2, label: 'other', tags: [] })
        return yield* byLabel('kept')
      }).pipe(
        Effect.provide(
          SqliteStore.layer({
            filename: ':memory:',
            migrations: { '1_tagged': migration('CREATE TABLE tagged (id INTEGER PRIMARY KEY, label TEXT NOT NULL, tags TEXT NOT NULL)') },
          }),
        ),
      )

      expect(items).toEqual([{ id: 1, label: 'kept', tags: ['a', 'b'] }])
    }).pipe(Effect.provide(platform)),
  )
})
