# `@dshfiles/sqlite-store`

One Effect `SqlClient` layer for a plugin-owned SQLite file, on `@effect/sql-sqlite-node` (the same synchronous
`node:sqlite` driver the hand-rolled stores use). It replaces the opener every store repeated: private directory,
pragmas, a `user_version` migration loop, owner-only sidecars, a prepared-statement cache and `BEGIN IMMEDIATE`
transactions.

It is a library package, not a Cordis bundle and not a dshx module: a Host entry lists it in
`host.bundleDependencies`, like `@dshfiles/credential-port`. It holds shared implementation, not a contract between
plugins, so no plugin imports another plugin's store.

## API

```ts
import { SqliteStore, type SqliteStoreOptions } from '@dshfiles/sqlite-store'
import { SqliteMigrationFailed, SqliteStoreOpenFailed, type SqliteStoreError, SqliteStoreVersionUnsupported } from '@dshfiles/sqlite-store/errors'

SqliteStore.layer(options): Layer<SqlClient.SqlClient, SqliteStoreError, FileSystem | Path>
SqliteStore.layerAs(Service, options): Layer<Service, SqliteStoreError, FileSystem | Path>
SqliteStore.make(options): Effect<SqlClient.SqlClient, SqliteStoreError, Scope | FileSystem | Path | Reactivity>
```

| Option              | Default   | Meaning                                                                                                                          |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `filename`          | —         | Absolute path, or `:memory:` (no file work, no lock).                                                                            |
| `migrations`        | —         | `Record<'<id>_<name>', Effect<void, unknown, SqlClient>>`, run by `effect/sql` `Migrator` (`fromRecord` + `SqliteMigrator.run`). |
| `legacyUserVersion` | none      | Last `PRAGMA user_version` the old opener wrote. Migrations `1..legacyUserVersion` must exist.                                   |
| `statementSpans`    | `false`   | Client span per SQL statement.                                                                                                   |
| `pragmas`           | see below | `journalMode` (`wal`), `synchronous` (`normal`), `busyTimeout` (5 s), `foreignKeys` (driver default: on).                        |

What one open does, in order:

1. Creates the parent directory with mode `0700` and, when missing, an empty file with mode `0600` so SQLite never
   creates it world-readable.
2. Opens one serialized connection (prepared-statement cache, `BEGIN IMMEDIATE` transactions), sets `busy_timeout`,
   the journal mode, `synchronous` and `foreign_keys`.
3. Under a per-file lock (two layers over one file in one process would otherwise busy-wait on each other while
   blocking the event loop), in one transaction: creates `effect_sql_migrations`, refuses a file recorded past the
   highest known migration id, and — only when that table is empty and `legacyUserVersion` is set — reads
   `PRAGMA user_version = N`, refuses `N > legacyUserVersion`, and records migrations `1..N` as applied without running
   them.
4. Runs the pending migrations in one transaction: one failure rolls back every migration of that open.
5. With `legacyUserVersion` set, writes the latest applied id back to `PRAGMA user_version`, so a downgrade to the old
   opener does not replay its `CREATE TABLE` steps.
6. Sets `0600` on the main file, `-wal` and `-shm`.

Errors are `Schema.TaggedError`s that keep the underlying `cause`: `SqliteStoreOpenFailed` (`step`:
`prepare-files | open | pragmas | restrict-files`), `SqliteMigrationFailed` (`kind`: the `MigrationError` kind or
`Sql`/`BadState`), `SqliteStoreVersionUnsupported` (`source`: `user-version | migrations`).

### Opening on the first use

`layer` and `layerAs` open when the layer is built, so a plugin that provides one at activation pays for the
connection, the pragmas and the migration check before anything reads the file (measured at 0.5 MB of Host heap per
store). When a plugin's first read or write genuinely comes later, wrap its own service layer in
`SqliteStore.deferred(Service, layer)`: it builds that layer on the first call to the service, inside the plugin's
scope, and retries a failed build on the next call instead of caching the failure.

The service must expose methods only: a property read cannot start the build, and a non-method property dies with a
message naming it. `usage` wires its repo that way, so an unopened usage panel costs the Host no store heap:

```ts
static readonly layerAt = (filename: string) =>
  SqliteStore.deferred(
    UsageRepo,
    Layer.effect(UsageRepo, open(filename)).pipe(Layer.provide(Reactivity.layer), Layer.provide(platform)),
  )
```

### Statement spans

`effect/sql` opens a client span for every statement from the calling fiber's tracer, and the client has no option to
turn that off. With `statementSpans: false` the store hands out a `SqlClient` whose statements (and their `.raw`,
`.values`, `.withoutTransform`, `.unprepared` variants, and `unsafe`) run with `Effect.withTracerEnabled(false)`. The
caller's own `Effect.fn` span, `Migrator <id>_<name>` spans, the `sql.transaction` span and the `sqlite-store open`
span stay. This keeps usage/memory volume out of the trace store and stops traces from tracing its own inserts.

### Several databases in one plugin

```ts
class SpanDb extends Context.Service<SpanDb, SqlClient.SqlClient>()('@dshfiles/traces/SpanDb') {
  static readonly layer = SqliteStore.layerAs(SpanDb, { filename: spansPath, migrations: spanMigrations, legacyUserVersion: 5 })
}
class AlertDb extends Context.Service<AlertDb, SqlClient.SqlClient>()('@dshfiles/traces/AlertDb') {
  static readonly layer = SqliteStore.layerAs(AlertDb, { filename: alertsPath, migrations: alertMigrations, legacyUserVersion: 1 })
}
```

Repos `yield* SpanDb` and use it as `sql`; decode rows with `SqlSchema.findAll/findOne/findOneOption/void`.

### Caveat

`node:sqlite` is synchronous: busy waits and long queries still block the Host event loop. This layer fixes lifecycle,
migrations and typing, not loop stalls; heavy indexing stays in a worker (session-search).

## Migrating

How each hand-rolled opener maps onto the layer. Keep every existing migration SQL verbatim as migration `<n>` so
adopted files and fresh files end with the same schema.

Migrated (the hand-rolled opener is gone):

| Store (layer)                                                                                    | Was                                                                       | Options                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| traces spans (`traces/src/trace-repo.ts`, `TraceDb`)                                             | `user_version` loop, 5 migrations; WAL, `synchronous=NORMAL`              | `legacyUserVersion: 5`; default pragmas                                                                       |
| traces alerts (`traces/src/alerts/alert-repo.ts`, `AlertDb`)                                     | `user_version` loop, 1 migration; seeds built-ins when version 0          | `legacyUserVersion: 1`; `pragmas: { synchronous: 'full' }`; seed inside migration `1_rules`                   |
| usage (`usage/src/host.ts`, migrations in `usage/src/migrations.ts`)                             | `user_version` loop, 8 migrations; WAL, `synchronous=NORMAL`              | `legacyUserVersion: 8`; default pragmas                                                                       |
| project-checks (`project-checks/src/durable-task-store.ts`)                                      | `user_version` 1, refused `> 1`; `foreign_keys=ON`, `timeout: 0`          | `legacyUserVersion: 1`; `pragmas: { journalMode: 'delete', foreignKeys: true, busyTimeout: 0 }`               |
| resource-packs (`resource-packs/src/store.ts`, migrations in `resource-packs/src/migrations.ts`) | `user_version` 1, refused `> 1`; `foreign_keys=ON`, `journal_mode=DELETE` | `legacyUserVersion: 1`; `pragmas: { journalMode: 'delete', foreignKeys: true }`; symlink checks in the plugin |

Still to migrate:

| Store (opener)                                                | Pragmas today                                     | Legacy version                                              | Options                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| memory (`memory/src/store.ts:278`)                            | WAL, `busy_timeout=5000`, no `synchronous` (FULL) | none: `create if not exists` + `hasColumn` → `ALTER` probes | no `legacyUserVersion`; idempotent migrations (below); `pragmas: { synchronous: 'full' }` or opt into `normal` |
| session-search (`session-search/src/index-db.ts:255`, worker) | WAL, `synchronous=normal`, no busy timeout (0)    | none: `CREATE ... IF NOT EXISTS`; backfill flags in `meta`  | no `legacyUserVersion`; migration 1 = `SCHEMA`; provide `NodeFileSystem`/`NodePath` in the worker              |

Per-store notes:

- **Seeds and resets.** A one-time seed that ran "when the file was created" (alerts' built-in rules) belongs inside
  migration 1, which an adopted file never re-runs. A recurring reset that is not a schema step (usage's
  `foldVersion` meta check) stays in the repo's `make`.
- **Stores without `user_version` (memory, session-search).** Their first migrations must be idempotent, because
  they run once against files that already hold the schema: migration 1 is the existing `create ... if not exists`
  script; each column probe becomes its own migration that checks `pragma_table_info` before `ALTER TABLE ... ADD
COLUMN` (memory: `messages.excerpt`, then `notes.archived_at`, then the `notes_valid_hash` → `notes_active_hash`
  index swap, already written with `if [not] exists`).
- **Refusing newer files.** resource-packs and project-checks refused `user_version > 1`; the layer now refuses both
  a legacy `user_version` past `legacyUserVersion` and a migrations table past the highest known id, for every store.
  traces, alerts and usage used to ignore a newer file silently.
- **Private paths.** Every opener's `mkdir 0700` and `chmod 0600` on main/`-wal`/`-shm` is built in. resource-packs
  and project-checks additionally refuse a symlinked directory or file (`lstat`, `O_NOFOLLOW`) and chmod an existing
  directory to `0700`; keep those checks in the plugin before providing the layer until a second store needs them.
- **Busy waits.** project-checks deliberately opens with `timeout: 0` and retries `BEGIN IMMEDIATE` asynchronously
  for up to 10 s so the Host loop never blocks; keep `busyTimeout: 0` and wrap its writes in `Effect.retry` with
  `Schedule.spaced('20 millis')` bounded at 10 s on a `LockTimeoutError` reason. Its second file,
  `worker-claim.sqlite`, is a cross-process lock, not a store; leave it as is.
- **Hand-rolled helpers go away.** The `Map<string, StatementSync>` caches become the client's prepared-statement
  cache; `transaction()` becomes `sql.withTransaction`; hand-decoded rows (`TracesSchema.decode`, `decodeStoreValue`,
  `String(row['x'])`) become `SqlSchema` with the row schema.
- **Before switching a live store,** copy the live file, open the copy with the new layer, and compare
  `sqlite3 <file> .dump` before and after: only `effect_sql_migrations` rows should differ.

## Scripts

```sh
pnpm --dir plugins/@dshfiles/sqlite-store build
pnpm --dir plugins/@dshfiles/sqlite-store test
pnpm --dir plugins/@dshfiles/sqlite-store typecheck
```
