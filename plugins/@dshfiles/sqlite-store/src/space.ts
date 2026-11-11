import { Clock, Duration, Effect, Schedule, Schema } from 'effect'
import { type SqlClient, SqlSchema } from 'effect/sql'

export type SqliteAutoVacuum = 'none' | 'full' | 'incremental'

export interface SqliteSpace {
  readonly pageSize: number
  readonly pages: number
  readonly freePages: number
  /** `page_count × page_size`: the main file without its `-wal`. */
  readonly bytes: number
  readonly freeBytes: number
  readonly autoVacuum: SqliteAutoVacuum
}

export interface SqliteReclaimResult {
  /** `incremental-vacuum` frees the free pages of an incremental file; `vacuum` rewrites a file that is not one and converts it. */
  readonly method: 'incremental-vacuum' | 'vacuum'
  readonly before: SqliteSpace
  readonly after: SqliteSpace
  readonly bytesFreed: number
  readonly durationMs: number
}

export interface SqliteIdleVacuum {
  /** Defaults to 5 minutes. */
  readonly every?: Duration.Input
  /**
   * Free pages returned per pass; defaults to 32 (128 KiB at the 4 KiB page size). On a copy of the traces store a
   * pass blocked 5–30 ms at 32 pages and 78–367 ms at 256, so a pass stays small and frequent.
   */
  readonly pages?: number
}

const AUTO_VACUUM_MODES: Readonly<Record<number, SqliteAutoVacuum>> = { 0: 'none', 1: 'full', 2: 'incremental' }
const DEFAULT_IDLE_VACUUM_EVERY = Duration.minutes(5)
const DEFAULT_IDLE_VACUUM_PAGES = 32

const spaceRow = Schema.Struct({ page_size: Schema.Int, page_count: Schema.Int, freelist_count: Schema.Int, auto_vacuum: Schema.Int })

const spaceOf = (sql: SqlClient.SqlClient) =>
  SqlSchema.findOne({
    Request: Schema.Void,
    Result: spaceRow,
    execute: () =>
      sql`SELECT page_size, page_count, freelist_count, auto_vacuum FROM pragma_page_size, pragma_page_count, pragma_freelist_count, pragma_auto_vacuum`,
  })(undefined).pipe(
    Effect.map((row): SqliteSpace => ({
      pageSize: row.page_size,
      pages: row.page_count,
      freePages: row.freelist_count,
      bytes: row.page_count * row.page_size,
      freeBytes: row.freelist_count * row.page_size,
      autoVacuum: AUTO_VACUUM_MODES[row.auto_vacuum] ?? 'none',
    })),
  )

/** Page counts and the auto-vacuum mode of the file behind `sql`. */
const space = Effect.fn('sqlite-store space')(function* (sql: SqlClient.SqlClient) {
  return yield* spaceOf(sql)
})

/**
 * Gives the file's free pages back to the filesystem, on the store's own connection so no other connection waits on
 * it. An incremental file runs `PRAGMA incremental_vacuum`, which moves only the pages past the free ones (2.4 s for
 * 27 MB of free pages on the same copy). Any other file is rewritten once with
 * `auto_vacuum = INCREMENTAL; VACUUM`, which converts it: that blocks the Host for the whole rewrite (3.4 s for a
 * 62 MB traces copy, 16 s for a 119 MB memory copy on a loaded machine) and briefly needs twice the disk, so it runs only when a user asked for it, never on its own.
 */
const reclaim = Effect.fn('sqlite-store reclaim')(function* (sql: SqlClient.SqlClient) {
  const started = yield* Clock.currentTimeMillis
  const before = yield* spaceOf(sql)
  const method = before.autoVacuum === 'incremental' ? 'incremental-vacuum' : 'vacuum'
  if (method === 'incremental-vacuum') yield* sql.unsafe('PRAGMA incremental_vacuum')
  else {
    yield* sql.unsafe('PRAGMA auto_vacuum = INCREMENTAL')
    yield* sql.unsafe('VACUUM')
  }
  yield* sql.unsafe('PRAGMA wal_checkpoint(TRUNCATE)')
  const after = yield* spaceOf(sql)
  const result: SqliteReclaimResult = {
    method,
    before,
    after,
    bytesFreed: Math.max(0, before.bytes - after.bytes),
    durationMs: (yield* Clock.currentTimeMillis) - started,
  }
  yield* Effect.annotateCurrentSpan({ 'db.sqlite.reclaim_method': method, 'db.sqlite.bytes_freed': result.bytesFreed })
  return result
})

const vacuumPages = Effect.fn('sqlite-store incremental vacuum')(function* (
  sql: SqlClient.SqlClient,
  input: { readonly pages: number; readonly freePages: number },
) {
  yield* sql.unsafe(`PRAGMA incremental_vacuum(${String(input.pages)})`)
  const freed = input.freePages - (yield* spaceOf(sql)).freePages
  yield* Effect.annotateCurrentSpan({ 'db.sqlite.pages_freed': freed, 'db.sqlite.free_pages_left': input.freePages - freed })
  return freed
})

/** One bounded pass: at most `pages` free pages. A file with none (or not incremental) costs one pragma read and no span. */
const incrementalVacuumPass = Effect.fnUntraced(function* (sql: SqlClient.SqlClient, pages: number) {
  const before = yield* spaceOf(sql)
  if (before.autoVacuum !== 'incremental' || before.freePages === 0) return 0
  return yield* vacuumPages(sql, { pages, freePages: before.freePages })
})

/** Runs a bounded pass on its schedule for the store's lifetime; a failed pass is skipped, never retried in a loop. */
const idleVacuum = (sql: SqlClient.SqlClient, options: SqliteIdleVacuum) => {
  const pages = Math.max(1, Math.floor(options.pages ?? DEFAULT_IDLE_VACUUM_PAGES))
  const pass = Effect.ignore(incrementalVacuumPass(sql, pages))
  return Effect.schedule(pass, Schedule.spaced(options.every ?? DEFAULT_IDLE_VACUUM_EVERY))
}

export const SqliteSpaceModel = { space, reclaim, incrementalVacuumPass, idleVacuum } as const
