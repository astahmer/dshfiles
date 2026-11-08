import { SqliteClient, SqliteMigrator } from '@effect/sql-sqlite-node'
import { type Context, Duration, Effect, FileSystem, Layer, Path, Schema, Semaphore } from 'effect'
import { Reactivity } from 'effect/reactivity'
import { Migrator, SqlClient, SqlSchema } from 'effect/sql'
import { SqliteMigrationFailed, SqliteStoreOpenFailed, type SqliteStoreError, SqliteStoreVersionUnsupported } from './errors.ts'
import { untracedSqlClient } from './untraced-sql-client.ts'

/** Migration effects keyed `<id>_<name>`, e.g. `0001_init`; ids are positive integers and `1..legacyUserVersion` map to the old `user_version` steps. */
export type SqliteStoreMigrations = Readonly<Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>>>

export interface SqliteStorePragmas {
  /** `wal` (default) or `delete` for stores that never kept a `-wal` sidecar. */
  readonly journalMode?: 'wal' | 'delete'
  /** Defaults to `normal`; `full` matches a store that never set it. */
  readonly synchronous?: 'off' | 'normal' | 'full'
  /** Defaults to 5 seconds. */
  readonly busyTimeout?: Duration.Input
  /** Left at the `node:sqlite` default (on) when omitted. */
  readonly foreignKeys?: boolean
}

export interface SqliteStoreOptions {
  /** Absolute path, or `:memory:`. */
  readonly filename: string
  readonly migrations: SqliteStoreMigrations
  /** The last `PRAGMA user_version` the hand-rolled store wrote; such a file is adopted by recording migrations `1..user_version` as applied. */
  readonly legacyUserVersion?: number
  /** Client spans per SQL statement; off by default so stores never flood (or feed back into) the trace store. */
  readonly statementSpans?: boolean
  readonly pragmas?: SqliteStorePragmas
}

const memoryFilename = ':memory:'
const migrationsTable = 'effect_sql_migrations'
const privateDirectoryMode = 0o700
const privateFileMode = 0o600

// Two layers over one file in one process must not migrate at once: the second BEGIN IMMEDIATE busy-waits
// synchronously, blocking the event loop the first one needs to commit.
const migrationLocks = new Map<string, Semaphore.Semaphore>()
const migrationLockFor = (filename: string): Semaphore.Semaphore => {
  const existing = migrationLocks.get(filename)
  if (existing !== undefined) return existing
  const lock = Semaphore.makeUnsafe(1)
  migrationLocks.set(filename, lock)
  return lock
}

const userVersionRow = Schema.Struct({ user_version: Schema.Int })
const latestMigrationRow = Schema.Struct({ latest: Schema.NullOr(Schema.Int) })

const sidecarsOf = (filename: string): ReadonlyArray<string> => [filename, `${filename}-wal`, `${filename}-shm`]

const prepareFiles = Effect.fnUntraced(function* (input: { readonly fs: FileSystem.FileSystem; readonly path: Path.Path; readonly filename: string }) {
  yield* input.fs.makeDirectory(input.path.dirname(input.filename), { recursive: true, mode: privateDirectoryMode })
  if (yield* input.fs.exists(input.filename)) return
  yield* input.fs.writeFile(input.filename, new Uint8Array(), { flag: 'a', mode: privateFileMode })
})

const restrictFiles = Effect.fnUntraced(function* (input: { readonly fs: FileSystem.FileSystem; readonly filename: string }) {
  for (const file of sidecarsOf(input.filename)) if (yield* input.fs.exists(file)) yield* input.fs.chmod(file, privateFileMode)
})

/**
 * A WAL that no connection checkpoints grows with every write: measured 246 MB beside a 245 MB usage
 * database, 160 MB beside traces and 102 MB beside memory. The limit keeps it at 32 MB and an automatic
 * checkpoint folds it back into the database.
 */
const WAL_SIZE_LIMIT_BYTES = 32 * 1024 * 1024
const WAL_AUTOCHECKPOINT_PAGES = 1_000

const pragmaStatements = (pragmas: SqliteStorePragmas): ReadonlyArray<string> => [
  ...(pragmas.journalMode === 'delete' ? ['PRAGMA journal_mode = DELETE'] : []),
  `PRAGMA synchronous = ${(pragmas.synchronous ?? 'normal').toUpperCase()}`,
  ...(pragmas.foreignKeys === undefined ? [] : [`PRAGMA foreign_keys = ${pragmas.foreignKeys ? 'ON' : 'OFF'}`]),
  `PRAGMA journal_size_limit = ${String(WAL_SIZE_LIMIT_BYTES)}`,
  `PRAGMA wal_autocheckpoint = ${String(WAL_AUTOCHECKPOINT_PAGES)}`,
]

type MigrationStepError = Migrator.MigrationError | { readonly _tag: 'SqlError' | 'SchemaError' | 'NoSuchElementError' }

const migrationFailureKind = (error: MigrationStepError): SqliteMigrationFailed['kind'] => {
  if (error._tag === 'MigrationError') return error.kind
  if (error._tag === 'SqlError') return 'Sql'
  return 'BadState'
}

const migrate = Effect.fnUntraced(function* (input: {
  readonly sql: SqlClient.SqlClient
  readonly filename: string
  readonly migrations: SqliteStoreMigrations
  readonly legacyUserVersion: number | undefined
}) {
  const sql = input.sql
  const resolved = yield* Migrator.fromRecord(input.migrations)
  const knownVersion = resolved.reduce((latest, [id]) => Math.max(latest, id), 0)
  const legacyUserVersion = input.legacyUserVersion
  if (legacyUserVersion !== undefined)
    for (let id = 1; id <= legacyUserVersion; id++)
      if (!resolved.some(([migrationId]) => migrationId === id))
        return yield* Effect.die(
          new Error(`SqliteStore ${input.filename}: legacyUserVersion ${String(legacyUserVersion)} needs a migration with id ${String(id)}.`),
        )

  const latestRecorded = SqlSchema.findOne({
    Request: Schema.Void,
    Result: latestMigrationRow,
    execute: () => sql`SELECT MAX(migration_id) AS latest FROM ${sql(migrationsTable)}`,
  })
  const userVersion = SqlSchema.findOne({ Request: Schema.Void, Result: userVersionRow, execute: () => sql`PRAGMA user_version` })

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`CREATE TABLE IF NOT EXISTS ${sql(migrationsTable)} (
        migration_id integer PRIMARY KEY NOT NULL,
        created_at datetime NOT NULL DEFAULT current_timestamp,
        name VARCHAR(255) NOT NULL
      )`
      const recorded = (yield* latestRecorded(undefined)).latest ?? 0
      if (recorded > knownVersion)
        return yield* new SqliteStoreVersionUnsupported({
          filename: input.filename,
          source: 'migrations',
          foundVersion: recorded,
          supportedVersion: knownVersion,
        })
      if (recorded > 0 || legacyUserVersion === undefined) return
      const legacyVersion = (yield* userVersion(undefined)).user_version
      if (legacyVersion > legacyUserVersion)
        return yield* new SqliteStoreVersionUnsupported({
          filename: input.filename,
          source: 'user-version',
          foundVersion: legacyVersion,
          supportedVersion: legacyUserVersion,
        })
      for (const [id, name] of resolved) if (id <= legacyVersion) yield* sql`INSERT INTO ${sql(migrationsTable)} (migration_id, name) VALUES (${id}, ${name})`
    }),
  )
  yield* SqliteMigrator.run({ loader: Effect.succeed(resolved) })
  if (legacyUserVersion === undefined) return
  const latest = (yield* latestRecorded(undefined)).latest ?? 0
  yield* sql.unsafe(`PRAGMA user_version = ${String(latest)}`)
})

const make = Effect.fn('sqlite-store open')(function* (options: SqliteStoreOptions) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const inMemory = options.filename === memoryFilename
  const filename = inMemory ? memoryFilename : path.resolve(options.filename)
  const pragmas = options.pragmas ?? {}
  const openFailed = (step: SqliteStoreOpenFailed['step']) => (cause: unknown) => new SqliteStoreOpenFailed({ filename, step, cause })

  if (!inMemory) yield* prepareFiles({ fs, path, filename }).pipe(Effect.mapError(openFailed('prepare-files')))
  const client = yield* SqliteClient.make({
    filename,
    busyTimeout: pragmas.busyTimeout ?? Duration.seconds(5),
    disableWAL: pragmas.journalMode === 'delete',
  }).pipe(Effect.mapError(openFailed('open')))
  const sql = options.statementSpans === true ? client : untracedSqlClient(client)
  yield* Effect.forEach(pragmaStatements(pragmas), statement => sql.unsafe(statement), { discard: true }).pipe(Effect.mapError(openFailed('pragmas')))

  const migration = migrate({ sql, filename, migrations: options.migrations, legacyUserVersion: options.legacyUserVersion }).pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
    Effect.mapError((error): SqliteStoreError =>
      error._tag === 'SqliteStoreVersionUnsupported' ? error : new SqliteMigrationFailed({ filename, kind: migrationFailureKind(error), cause: error }),
    ),
  )
  yield* inMemory ? migration : Semaphore.withPermit(migrationLockFor(filename), migration)

  if (!inMemory) yield* restrictFiles({ fs, filename }).pipe(Effect.mapError(openFailed('restrict-files')))
  return sql
})

const layerAs = <Self>(
  service: Context.Service<Self, SqlClient.SqlClient>,
  options: SqliteStoreOptions,
): Layer.Layer<Self, SqliteStoreError, FileSystem.FileSystem | Path.Path> => Layer.effect(service, make(options)).pipe(Layer.provide(Reactivity.layer))

const layer = (options: SqliteStoreOptions): Layer.Layer<SqlClient.SqlClient, SqliteStoreError, FileSystem.FileSystem | Path.Path> =>
  layerAs(SqlClient.SqlClient, options)

export const SqliteStore = {
  /** Open, configure and migrate one SQLite file; the connection closes with the surrounding scope. */
  make,
  /** Provide the store as the default `SqlClient`. */
  layer,
  /** Provide the store under a plugin-owned service key, so one plugin can hold several databases. */
  layerAs,
} as const
