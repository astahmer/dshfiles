import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { z } from 'zod'
import type { RegistryToolSource } from '@dshfiles/dshx/api'
import { CostEstimateModel } from '@dshfiles/ai-accounts/cost-estimate'
import type { ChartQuery, ChartView, RequestPage, RequestQuery, RequestView } from './api.js'
import {
  JEV_INPUT_USD_PER_MILLION,
  jevCredentialLabelSchema,
  type JevUsageBreakdown,
  type JevUsageQuery,
  type JevUsageRecord,
  type JevUsageView,
  jevUsageOutcomeSchema,
  jevUsageSourceSchema,
} from './jev-usage.js'
import { UsageFoldModel, type RequestRow, type SessionMeta, type ToolExecutionRow } from './fold.js'
import { createOtlpMetricsRequest, type OtlpCounterInput, type OtlpHistogramInput, type OtlpTemporality } from './otel-metrics.js'

/**
 * The usage index: one row per model request, one per session, and one per
 * session log with the byte offset and fold state reached, so a pass only
 * decodes what the log gained since. Costs are never stored: queries join
 * `route_rates` (USD per million tokens per route and context band), which
 * the Host rebuilds whenever the price catalog changes.
 */

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE files (
    path TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    offset INTEGER NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL,
    state TEXT NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT,
    project TEXT,
    title TEXT,
    parent_session TEXT,
    subagent INTEGER NOT NULL,
    created_at INTEGER
  ) STRICT;

  CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER,
    message_id TEXT,
    turn INTEGER,
    step INTEGER,
    purpose TEXT NOT NULL,
    source TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    ttft_ms INTEGER,
    input INTEGER,
    cache_read INTEGER,
    cache_write INTEGER,
    output INTEGER,
    reasoning INTEGER,
    band INTEGER NOT NULL,
    status TEXT NOT NULL,
    stop_reason TEXT,
    error_code TEXT,
    merged_into TEXT,
    settled INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX requests_started ON requests (started_at);
  CREATE INDEX requests_session ON requests (session_id, started_at);
  CREATE INDEX requests_unsettled ON requests (settled) WHERE settled = 0;

  CREATE TABLE route_rates (
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    band INTEGER NOT NULL,
    input REAL NOT NULL,
    output REAL NOT NULL,
    cache_read REAL NOT NULL,
    cache_write REAL NOT NULL,
    PRIMARY KEY (provider, model, band)
  ) STRICT, WITHOUT ROWID;

  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
  `,
  // Pricing reads the distinct routes that have usage; the partial index answers it without reading request rows.
  'CREATE INDEX requests_route_band ON requests (provider, model, band) WHERE input IS NOT NULL;',
  `
  CREATE TABLE jev_requests (
    request_id TEXT PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('backlog', 'memory')),
    started_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 3600000),
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
    input_tokens INTEGER CHECK (input_tokens >= 0),
    output_tokens INTEGER CHECK (output_tokens >= 0)
  ) STRICT;
  CREATE INDEX jev_requests_started ON jev_requests (started_at);
  `,
  `ALTER TABLE jev_requests ADD COLUMN credential TEXT NOT NULL DEFAULT 'Legacy / unknown' CHECK (length(credential) BETWEEN 1 AND 400);`,
  `
  CREATE TABLE tools (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    turn INTEGER,
    step INTEGER,
    name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'interrupted', 'unknown', 'pending')),
    category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('api', 'mcp', 'plugin', 'tool', 'skill', 'other')),
    owner TEXT
  ) STRICT;
  CREATE INDEX tools_started ON tools (started_at);
  CREATE INDEX tools_name_started ON tools (name, started_at);
  CREATE INDEX tools_category_started ON tools (category, started_at);
  CREATE INDEX tools_outcome_started ON tools (outcome, started_at);
  `,
  `ALTER TABLE tools ADD COLUMN normalized_command TEXT CHECK (normalized_command IS NULL OR length(normalized_command) BETWEEN 1 AND 80);`,
  `ALTER TABLE tools ADD COLUMN test_runner TEXT CHECK (test_runner IS NULL OR length(test_runner) BETWEEN 1 AND 80);`,
  `ALTER TABLE tools ADD COLUMN result_chars INTEGER CHECK (result_chars IS NULL OR result_chars BETWEEN 0 AND 100000000);`,
]

export interface RouteBand {
  readonly provider: string
  readonly model: string
  readonly band: number
}

export interface Rates {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

/** Bump whenever the fold reads a log differently. */
const FOLD_VERSION = 4

/** Live side calls wait this long for the log row they duplicate before they count on their own. */
const LIVE_MATCH_WAIT_MS = 10 * 60_000
const LIVE_MATCH_WINDOW_MS = 2 * 60_000
const SERIES_KEYS = 6
const OTHER_KEY = 'Other'

/** `~/dev/dshfiles-threads/dshfiles-221d06c1` is a thread workspace of `dshfiles`. */
export const projectOf = (cwd: string | null): string | null => {
  if (cwd === null || cwd.length === 0) return null
  const parent = basename(dirname(cwd))
  if (parent.endsWith('-threads') && parent.length > '-threads'.length) return parent.slice(0, -'-threads'.length)
  return basename(cwd)
}

const textColumn = z.string().nullable()
const numberColumn = z.number().nullable()

const requestRowSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  title: textColumn,
  parent_session: textColumn,
  project: textColumn,
  cwd: textColumn,
  seq: numberColumn,
  message_id: textColumn,
  turn: numberColumn,
  step: numberColumn,
  purpose: z.enum(UsageFoldModel.REQUEST_PURPOSES),
  provider: z.string(),
  model: z.string(),
  started_at: z.number(),
  duration_ms: numberColumn,
  ttft_ms: numberColumn,
  input: numberColumn,
  cache_read: numberColumn,
  cache_write: numberColumn,
  output: numberColumn,
  cost: numberColumn,
  status: z.enum(UsageFoldModel.REQUEST_STATUSES),
  stop_reason: textColumn,
  error_code: textColumn,
})

const countRowSchema = z.object({ key: z.string(), count: z.number() })
const fileRowSchema = z.object({ path: z.string(), offset: z.number(), size: z.number(), mtime_ms: z.number(), state: z.string() })

const bucketRowSchema = z.object({
  start: z.number(),
  key: z.string().nullable(),
  cost: z.number(),
  requests: z.number(),
  failed: z.number(),
  input: z.number(),
  cache_read: z.number(),
  cache_write: z.number(),
  output: z.number(),
})

const breakdownRowSchema = z.object({ key: z.string().nullable(), cost: z.number(), requests: z.number(), tokens: z.number() })
const latencyRowSchema = z.object({ start: z.number(), ttft_ms: numberColumn, duration_ms: numberColumn })
const threadRowSchema = z.object({ session_id: z.string(), title: textColumn, project: textColumn, cost: z.number(), requests: z.number() })
const toolRowSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  seq: z.number().int(),
  turn: z.number().int().nullable(),
  step: z.number().int().nullable(),
  name: z.string().min(1).max(120),
  category: z.enum(['api', 'mcp', 'plugin', 'tool', 'skill', 'other']),
  owner: textColumn,
  normalizedCommand: z.string().max(80).nullable().default(null),
  testRunner: z.string().max(80).nullable().default(null),
  startedAt: z.number().int(),
  endedAt: z.number().int().nullable(),
  outcome: z.enum(['success', 'error', 'interrupted', 'unknown', 'pending']),
  resultChars: z.number().int().min(0).max(100_000_000).nullable().default(null),
})
const durationTotalSchema = z.object({ totalDurationMs: z.number().int().nonnegative() })
const identifierActivityRowSchema = z.object({
  identifier: z.string(),
  calls: z.number().int(),
  totalDurationMs: z.number().int().nonnegative(),
  successes: z.number().int(),
  errors: z.number().int(),
  interrupted: z.number().int(),
  unknown: z.number().int(),
  pending: z.number().int(),
})
const toolActivityRowSchema = z.object({
  name: z.string(),
  category: z.enum(['api', 'mcp', 'plugin', 'tool', 'skill', 'other']),
  owner: textColumn,
  calls: z.number().int(),
  successes: z.number().int(),
  errors: z.number().int(),
  interrupted: z.number().int(),
  unknown: z.number().int(),
  pending: z.number().int(),
  firstStartedAt: numberColumn,
  lastStartedAt: numberColumn,
  firstEndedAt: numberColumn,
  lastEndedAt: numberColumn,
  averageDurationMs: numberColumn,
  totalDurationMs: z.number().int().nonnegative(),
  p50DurationMs: numberColumn,
  p90DurationMs: numberColumn,
  maxDurationMs: numberColumn,
  resultChars: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  measuredCalls: z.number().int().nonnegative(),
})
const activityCategoryRowSchema = z.object({
  category: z.enum(['api', 'mcp', 'plugin', 'tool', 'skill', 'other']),
  calls: z.number().int(),
  successes: z.number().int(),
  errors: z.number().int(),
  interrupted: z.number().int(),
  unknown: z.number().int(),
  pending: z.number().int(),
  averageDurationMs: numberColumn,
  p50DurationMs: numberColumn,
  p90DurationMs: numberColumn,
  maxDurationMs: numberColumn,
  resultChars: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  measuredCalls: z.number().int().nonnegative(),
})
const timelineRowSchema = z.object({
  start: z.number().int(),
  category: z.enum(['api', 'mcp', 'plugin', 'tool', 'skill', 'other']),
  calls: z.number().int(),
  errors: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
})
const activityTotalsRowSchema = z.object({
  calls: z.number().int(),
  successes: z.number().int(),
  errors: z.number().int(),
  interrupted: z.number().int(),
  unknown: z.number().int(),
  pending: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  measuredCalls: z.number().int().nonnegative(),
})
const jevEventRowSchema = z.object({
  at: z.number().int(),
  endedAt: z.number().int(),
  durationMs: z.number().int(),
  source: jevUsageSourceSchema,
  outcome: jevUsageOutcomeSchema,
})
const jevOutcomeRowSchema = z.object({ outcome: jevUsageOutcomeSchema, calls: z.number().int() })
const jevActivityRowSchema = z.object({
  calls: z.number().int(),
  successes: z.number().int(),
  failures: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  durationMs: numberColumn,
  maxDurationMs: numberColumn,
})
const TOOL_RETENTION_MS = 365 * 24 * 60 * 60 * 1000
const MAX_PENDING_MS = 24 * 60 * 60 * 1000
const OTEL_DURATION_BOUNDS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60] as const
const OTEL_DURATION_BOUNDS_MS = OTEL_DURATION_BOUNDS_SECONDS.map(seconds => seconds * 1_000)
const OTEL_BUCKET_SELECT = OTEL_DURATION_BOUNDS_MS.map(
  (bound, index) => `SUM(CASE WHEN duration_ms <= ${String(bound)} THEN 1 ELSE 0 END) AS bucket${String(index)}`,
).join(', ')
const OTEL_BUCKET_ROW_SCHEMA = z.object({
  bucket0: z.number().int(),
  bucket1: z.number().int(),
  bucket2: z.number().int(),
  bucket3: z.number().int(),
  bucket4: z.number().int(),
  bucket5: z.number().int(),
  bucket6: z.number().int(),
  bucket7: z.number().int(),
  bucket8: z.number().int(),
  bucket9: z.number().int(),
  bucket10: z.number().int(),
  bucket11: z.number().int(),
  bucket12: z.number().int(),
})
const OTEL_HISTOGRAM_BASE_ROW_SCHEMA = z.object({ calls: z.number().int(), durationSumMs: z.number() }).extend(OTEL_BUCKET_ROW_SCHEMA.shape)
const OTEL_TOOL_CATEGORIES = ['api', 'mcp', 'plugin', 'tool', 'skill', 'other'] as const
const OTEL_TOOL_OUTCOMES = ['success', 'error', 'interrupted', 'unknown', 'pending'] as const

const summaryRowSchema = z.object({
  cost: z.number(),
  requests: z.number(),
  failed: z.number(),
  aborted: z.number(),
  input: z.number(),
  cache_read: z.number(),
  cache_write: z.number(),
  output: z.number(),
  unpriced: z.number(),
  cacheSavings: z.number(),
  turns: z.number().int(),
})

/** Would-be prompt cost of cache reads minus what they were billed, per route list price. */
const CACHE_SAVINGS_SQL = `CASE WHEN rr.provider IS NULL OR r.cache_read IS NULL THEN 0
  ELSE r.cache_read * (rr.input - rr.cache_read) / 1000000.0 END`

const TURNS_SQL = "COUNT(DISTINCT CASE WHEN r.turn IS NULL THEN NULL ELSE r.session_id || ':' || r.turn END)"

const COST_SQL = `CASE WHEN rr.provider IS NULL OR r.input IS NULL THEN NULL
  ELSE (r.input * rr.input + r.output * rr.output + r.cache_read * rr.cache_read + r.cache_write * rr.cache_write) / 1000000.0 END`

const TOKENS_SQL = 'COALESCE(r.input, 0) + COALESCE(r.cache_read, 0) + COALESCE(r.cache_write, 0) + COALESCE(r.output, 0)'

const FROM_SQL = `requests r
  LEFT JOIN sessions s ON s.id = r.session_id
  LEFT JOIN route_rates rr ON rr.provider = r.provider AND rr.model = r.model AND rr.band = r.band`

/** Hidden: live calls folded into their log row, and live calls still waiting for one. */
const VISIBLE_SQL = "r.merged_into IS NULL AND NOT (r.source = 'live' AND r.settled = 0)"

const SORT_SQL = {
  startedAt: 'r.started_at',
  cost: 'cost',
  input: 'r.input',
  cacheRead: 'r.cache_read',
  output: 'r.output',
  durationMs: 'duration_ms',
  ttftMs: 'r.ttft_ms',
} satisfies Readonly<Record<RequestQuery['sort'], string>>

const percentile = (sorted: readonly number[], fraction: number): number | null => {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? null
}

export type UsageStore = ReturnType<typeof openUsageStore>

export const openUsageStore = (path: string) => {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(path)
  database.exec('PRAGMA busy_timeout = 5000')
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA synchronous = NORMAL')
  const version = z.object({ user_version: z.number() }).parse(database.prepare('PRAGMA user_version').get()).user_version
  for (let index = version; index < MIGRATIONS.length; index++) {
    database.exec('BEGIN IMMEDIATE')
    database.exec(MIGRATIONS[index] ?? '')
    database.exec(`PRAGMA user_version = ${String(index + 1)}`)
    database.exec('COMMIT')
  }
  if (path !== ':memory:') for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) chmodSync(file, 0o600)

  // Rows are folded once and only topped up afterwards, so a fold that reads logs differently re-reads them all.
  const foldVersion = database.prepare("SELECT value FROM meta WHERE key = 'foldVersion'").get()
  if (z.object({ value: z.string() }).optional().parse(foldVersion)?.value !== String(FOLD_VERSION)) {
    database.exec('BEGIN IMMEDIATE')
    database.exec(
      "DELETE FROM files; DELETE FROM requests WHERE source = 'log'; DELETE FROM tools; UPDATE requests SET merged_into = NULL, settled = 0 WHERE purpose IN ('title', 'compaction')",
    )
    database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('foldVersion', ?)").run(String(FOLD_VERSION))
    database.exec('COMMIT')
  }

  const statements = new Map<string, StatementSync>()
  const prepare = (sql: string): StatementSync => {
    const cached = statements.get(sql)
    if (cached !== undefined) return cached
    const statement = database.prepare(sql)
    statements.set(sql, statement)
    return statement
  }

  /** Routes with usage, keyed by `routeBandKey`; filled on the first pricing pass. */
  let pricedRoutes: Map<string, RouteBand> | undefined
  const routeBandKey = (route: RouteBand): string => `${route.provider}\u0000${route.model}\u0000${String(route.band)}`

  const transaction = <Result>(work: () => Result): Result => {
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  const pruneTelemetry = (now = Date.now()): void => {
    prepare('DELETE FROM tools WHERE started_at < ?').run(now - TOOL_RETENTION_MS)
    prepare("UPDATE tools SET outcome = 'unknown' WHERE outcome = 'pending' AND started_at < ?").run(now - MAX_PENDING_MS)
  }

  const upsertRequest = (row: RequestRow, settled: boolean): void => {
    const usage = row.usage
    const band = usage === null ? 0 : CostEstimateModel.contextBand(usage.input + usage.cacheRead + usage.cacheWrite)
    prepare(
      `INSERT INTO requests (id, session_id, seq, message_id, turn, step, purpose, source, provider, model, started_at, ended_at, ttft_ms,
         input, cache_read, cache_write, output, reasoning, band, status, stop_reason, error_code, merged_into, settled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT (id) DO UPDATE SET
         seq = excluded.seq, message_id = excluded.message_id, turn = excluded.turn, step = excluded.step, purpose = excluded.purpose,
         provider = excluded.provider, model = excluded.model, started_at = excluded.started_at, ended_at = excluded.ended_at,
         ttft_ms = COALESCE(excluded.ttft_ms, requests.ttft_ms),
         input = COALESCE(excluded.input, requests.input), cache_read = COALESCE(excluded.cache_read, requests.cache_read),
         cache_write = COALESCE(excluded.cache_write, requests.cache_write), output = COALESCE(excluded.output, requests.output),
         reasoning = COALESCE(excluded.reasoning, requests.reasoning),
         band = CASE WHEN excluded.input IS NULL THEN requests.band ELSE excluded.band END,
         status = excluded.status, stop_reason = excluded.stop_reason, error_code = excluded.error_code`,
    ).run(
      row.id,
      row.sessionId,
      row.seq,
      row.messageId,
      row.turn,
      row.step,
      row.purpose,
      row.source,
      row.provider,
      row.model,
      Math.round(row.startedAt),
      row.endedAt === null ? null : Math.round(row.endedAt),
      row.ttftMs === null ? null : Math.round(row.ttftMs),
      usage?.input ?? null,
      usage?.cacheRead ?? null,
      usage?.cacheWrite ?? null,
      usage?.output ?? null,
      usage?.reasoning ?? null,
      band,
      row.status,
      row.stopReason,
      row.errorCode,
      settled ? 1 : 0,
    )
    if (usage !== null) pricedRoutes?.set(routeBandKey({ provider: row.provider, model: row.model, band }), { provider: row.provider, model: row.model, band })
  }

  const upsertToolExecution = (row: z.infer<typeof toolRowSchema>): void => {
    prepare(`INSERT INTO tools (id, session_id, seq, turn, step, name, started_at, ended_at, outcome, category, owner, normalized_command, test_runner, result_chars)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET turn = excluded.turn, step = excluded.step, name = excluded.name,
        started_at = excluded.started_at, ended_at = excluded.ended_at, outcome = excluded.outcome,
        category = excluded.category, owner = excluded.owner, normalized_command = excluded.normalized_command,
        test_runner = excluded.test_runner, result_chars = COALESCE(excluded.result_chars, tools.result_chars)`).run(
      row.id,
      row.sessionId,
      row.seq,
      row.turn,
      row.step,
      row.name,
      row.startedAt,
      row.endedAt,
      row.outcome,
      row.category,
      row.owner,
      row.normalizedCommand,
      row.testRunner,
      row.resultChars,
    )
  }

  const upsertSession = (session: SessionMeta): void => {
    prepare(
      `INSERT INTO sessions (id, cwd, project, title, parent_session, subagent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET cwd = excluded.cwd, project = excluded.project, title = COALESCE(excluded.title, sessions.title),
         parent_session = excluded.parent_session, subagent = excluded.subagent, created_at = excluded.created_at`,
    ).run(session.id, session.cwd, projectOf(session.cwd), session.title, session.parentSession, session.subagent ? 1 : 0, session.createdAt)
  }

  const fileCursor = (filePath: string): z.infer<typeof fileRowSchema> | undefined => {
    const row = prepare('SELECT path, offset, size, mtime_ms, state FROM files WHERE path = ?').get(filePath)
    return row === undefined ? undefined : fileRowSchema.parse(row)
  }

  /** Commit one log slice: its rows, its session and the new cursor, or none of them. */
  const commitLogSlice = (slice: {
    readonly path: string
    readonly sessionId: string
    readonly offset: number
    readonly size: number
    readonly mtimeMs: number
    readonly state: string
    readonly session: SessionMeta | null
    readonly rows: readonly RequestRow[]
    readonly tools?: readonly ToolExecutionRow[]
  }): void =>
    transaction(() => {
      for (const row of slice.rows) upsertRequest(row, true)
      for (const row of slice.tools ?? []) upsertToolExecution(toolRowSchema.parse(row))
      pruneTelemetry()
      if (slice.session !== null) upsertSession(slice.session)
      prepare(
        `INSERT INTO files (path, session_id, offset, size, mtime_ms, state) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET session_id = excluded.session_id, offset = excluded.offset, size = excluded.size,
           mtime_ms = excluded.mtime_ms, state = excluded.state`,
      ).run(slice.path, slice.sessionId, slice.offset, slice.size, slice.mtimeMs, slice.state)
    })

  const insertLiveCall = (row: RequestRow): void => {
    // Side calls the log also records wait for reconciliation; the rest count at once.
    upsertRequest(row, row.purpose !== 'title' && row.purpose !== 'compaction')
  }

  /**
   * Fold each waiting live call into the log row describing the same request
   * (titles gain the usage the log never kept), or let it stand on its own
   * once no log row turned up in time.
   */
  const reconcileLiveCalls = (now: number): number => {
    const waiting = z
      .array(z.object({ id: z.string(), session_id: z.string(), purpose: z.string(), started_at: z.number() }))
      .parse(prepare("SELECT id, session_id, purpose, started_at FROM requests WHERE settled = 0 AND source = 'live'").all())
    let merged = 0
    transaction(() => {
      for (const live of waiting) {
        const match = prepare(
          `SELECT id FROM requests r WHERE r.source = 'log' AND r.session_id = ? AND r.purpose = ? AND r.started_at BETWEEN ? AND ?
             AND NOT EXISTS (SELECT 1 FROM requests m WHERE m.merged_into = r.id)
           ORDER BY ABS(r.started_at - ?) LIMIT 1`,
        ).get(live.session_id, live.purpose, live.started_at - LIVE_MATCH_WINDOW_MS, live.started_at + LIVE_MATCH_WINDOW_MS, live.started_at)
        const target = match === undefined ? undefined : z.object({ id: z.string() }).parse(match).id
        if (target !== undefined) {
          prepare(
            `UPDATE requests SET
               input = COALESCE(input, (SELECT input FROM requests WHERE id = ?)),
               cache_read = COALESCE(cache_read, (SELECT cache_read FROM requests WHERE id = ?)),
               cache_write = COALESCE(cache_write, (SELECT cache_write FROM requests WHERE id = ?)),
               output = COALESCE(output, (SELECT output FROM requests WHERE id = ?)),
               reasoning = COALESCE(reasoning, (SELECT reasoning FROM requests WHERE id = ?)),
               ttft_ms = COALESCE(ttft_ms, (SELECT ttft_ms FROM requests WHERE id = ?)),
               band = CASE WHEN input IS NULL THEN (SELECT band FROM requests WHERE id = ?) ELSE band END
             WHERE id = ?`,
          ).run(live.id, live.id, live.id, live.id, live.id, live.id, live.id, target)
          prepare('UPDATE requests SET merged_into = ?, settled = 1 WHERE id = ?').run(target, live.id)
          merged++
        } else if (live.started_at < now - LIVE_MATCH_WAIT_MS) {
          prepare('UPDATE requests SET settled = 1 WHERE id = ?').run(live.id)
        }
      }
    })
    return merged
  }

  const routeBands = (): RouteBand[] =>
    z
      .array(z.object({ provider: z.string(), model: z.string(), band: z.number() }))
      .parse(prepare('SELECT DISTINCT provider, model, band FROM requests WHERE input IS NOT NULL').all())

  /**
   * Pricing runs after every index pass and asked SQLite for the distinct routes of all 150 000 requests each time
   * (50–450 ms on the Host's event loop). The set is read once and topped up as requests with usage land.
   */
  const unratedRouteBands = (): RouteBand[] => {
    pricedRoutes ??= new Map(routeBands().map(route => [routeBandKey(route), route]))
    const rated = new Set(
      z
        .array(z.object({ provider: z.string(), model: z.string(), band: z.number() }))
        .parse(prepare('SELECT provider, model, band FROM route_rates').all())
        .map(routeBandKey),
    )
    return [...pricedRoutes.values()].filter(route => !rated.has(routeBandKey(route)))
  }

  /** Replace every rate (`replace: true`) or add the missing ones. */
  const writeRates = (input: { readonly rates: ReadonlyMap<string, { readonly route: RouteBand; readonly rates: Rates }>; readonly replace: boolean }): void =>
    transaction(() => {
      if (input.replace) prepare('DELETE FROM route_rates').run()
      for (const entry of input.rates.values()) {
        prepare('INSERT OR REPLACE INTO route_rates (provider, model, band, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          entry.route.provider,
          entry.route.model,
          entry.route.band,
          entry.rates.input,
          entry.rates.output,
          entry.rates.cacheRead,
          entry.rates.cacheWrite,
        )
      }
    })

  const getMeta = (key: string): string | null => {
    const row = prepare('SELECT value FROM meta WHERE key = ?').get(key)
    return row === undefined ? null : z.object({ value: z.string() }).parse(row).value
  }

  const setMeta = (key: string, value: string): void => {
    prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value)
  }

  const rangeFilter = (query: { readonly from: number; readonly to: number; readonly purposes?: readonly string[] | undefined }) => {
    const clauses = [VISIBLE_SQL, 'r.started_at >= ?', 'r.started_at < ?']
    const params: SQLInputValue[] = [query.from, query.to]
    if (query.purposes !== undefined && query.purposes.length > 0) {
      clauses.push(`r.purpose IN (${query.purposes.map(() => '?').join(', ')})`)
      params.push(...query.purposes)
    }
    return { clauses, params }
  }

  const requestFilter = (query: RequestQuery, withPurposes: boolean) => {
    const filter = rangeFilter(withPurposes ? query : { from: query.from, to: query.to })
    if (query.search !== undefined) {
      const like = `%${query.search.toLowerCase().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
      filter.clauses.push(
        "(LOWER(r.model) LIKE ? ESCAPE '\\' OR LOWER(r.provider) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(s.project, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(s.title, '')) LIKE ? ESCAPE '\\')",
      )
      filter.params.push(like, like, like, like)
    }
    if (query.sessionId !== undefined) {
      filter.clauses.push('r.session_id = ?')
      filter.params.push(query.sessionId)
    }
    return { where: filter.clauses.join(' AND '), params: filter.params }
  }

  const requests = (query: RequestQuery): RequestPage => {
    const filter = requestFilter(query, true)
    const where = filter.where
    const statusCounts = z
      .array(countRowSchema)
      .parse(prepare(`SELECT r.status AS key, COUNT(*) AS count FROM ${FROM_SQL} WHERE ${where} GROUP BY r.status`).all(...filter.params))
    const unfiltered = requestFilter(query, false)
    const purposeCounts = z
      .array(countRowSchema)
      .parse(prepare(`SELECT r.purpose AS key, COUNT(*) AS count FROM ${FROM_SQL} WHERE ${unfiltered.where} GROUP BY r.purpose`).all(...unfiltered.params))
    const statusClause = query.status === undefined ? '' : ' AND r.status = ?'
    const rows = z.array(requestRowSchema).parse(
      prepare(
        `SELECT r.id, r.session_id, s.title, s.parent_session, s.project, s.cwd, r.seq, r.message_id, r.turn, r.step, r.purpose, r.provider, r.model, r.started_at,
           CASE WHEN r.ended_at IS NULL THEN NULL ELSE r.ended_at - r.started_at END AS duration_ms, r.ttft_ms,
           r.input, r.cache_read, r.cache_write, r.output, ${COST_SQL} AS cost, r.status, r.stop_reason, r.error_code
         FROM ${FROM_SQL} WHERE ${where}${statusClause}
         ORDER BY ${SORT_SQL[query.sort]} IS NULL, ${SORT_SQL[query.sort]} ${query.direction === 'asc' ? 'ASC' : 'DESC'}, r.started_at DESC
         LIMIT ?`,
      ).all(...filter.params, ...(query.status === undefined ? [] : [query.status]), query.limit),
    )
    const total = statusCounts.reduce((sum, row) => sum + row.count, 0)
    return {
      rows: rows.map((row): RequestView => ({
        id: row.id,
        sessionId: row.session_id,
        sessionTitle: row.title,
        parentSessionId: row.parent_session,
        project: row.project,
        cwd: row.cwd,
        seq: row.seq,
        messageId: row.message_id,
        turn: row.turn,
        step: row.step,
        purpose: row.purpose,
        provider: row.provider,
        model: row.model,
        startedAt: row.started_at,
        durationMs: row.duration_ms,
        ttftMs: row.ttft_ms,
        input: row.input,
        cacheRead: row.cache_read,
        cacheWrite: row.cache_write,
        output: row.output,
        cost: row.cost,
        status: row.status,
        stopReason: row.stop_reason,
        errorCode: row.error_code,
      })),
      total,
      statusCounts: Object.fromEntries([['all', total], ...statusCounts.map(row => [row.key, row.count] as const)]),
      purposeCounts: Object.fromEntries(purposeCounts.map(row => [row.key, row.count] as const)),
    }
  }

  const summaryOf = (filter: ReturnType<typeof rangeFilter>) =>
    summaryRowSchema.parse(
      prepare(
        `SELECT COALESCE(SUM(${COST_SQL}), 0) AS cost, COUNT(*) AS requests,
           COALESCE(SUM(r.status = 'failed'), 0) AS failed, COALESCE(SUM(r.status = 'aborted'), 0) AS aborted,
           COALESCE(SUM(r.input), 0) AS input, COALESCE(SUM(r.cache_read), 0) AS cache_read,
           COALESCE(SUM(r.cache_write), 0) AS cache_write, COALESCE(SUM(r.output), 0) AS output,
           COALESCE(SUM(r.input IS NOT NULL AND rr.provider IS NULL), 0) AS unpriced,
           COALESCE(SUM(${CACHE_SAVINGS_SQL}), 0) AS cacheSavings, ${TURNS_SQL} AS turns
         FROM ${FROM_SQL} WHERE ${filter.clauses.join(' AND ')}`,
      ).get(...filter.params),
    )

  const charts = (query: ChartQuery): ChartView => {
    const filter = rangeFilter(query)
    const where = filter.clauses.join(' AND ')
    const bucketMs = query.bucket === 'hour' ? 3_600_000 : 86_400_000
    const offsetMs = query.tzOffsetMinutes * 60_000
    const bucketSql = `((r.started_at + ${String(offsetMs)}) / ${String(bucketMs)}) * ${String(bucketMs)} - ${String(offsetMs)}`
    const dimensionSql = { model: 'r.model', provider: 'r.provider', project: "COALESCE(s.project, '(none)')", purpose: 'r.purpose' } as const

    const breakdown = (dimension: keyof typeof dimensionSql) =>
      z
        .array(breakdownRowSchema)
        .parse(
          prepare(
            `SELECT ${dimensionSql[dimension]} AS key, COALESCE(SUM(${COST_SQL}), 0) AS cost, COUNT(*) AS requests, COALESCE(SUM(${TOKENS_SQL}), 0) AS tokens
             FROM ${FROM_SQL} WHERE ${where} GROUP BY key ORDER BY cost DESC, requests DESC`,
          ).all(...filter.params),
        )
        .map(row => ({ key: row.key ?? '(none)', cost: row.cost, requests: row.requests, tokens: row.tokens }))

    const byDimension = { model: breakdown('model'), provider: breakdown('provider'), project: breakdown('project') }
    const ranked = query.groupBy === 'purpose' ? breakdown('purpose') : byDimension[query.groupBy]
    const leading = new Set(ranked.slice(0, ranked.length > SERIES_KEYS ? SERIES_KEYS - 1 : SERIES_KEYS).map(row => row.key))
    const keys = [...leading, ...(ranked.length > leading.size ? [OTHER_KEY] : [])]

    const rawBuckets = z.array(bucketRowSchema).parse(
      prepare(
        `SELECT ${bucketSql} AS start, ${dimensionSql[query.groupBy]} AS key, COALESCE(SUM(${COST_SQL}), 0) AS cost, COUNT(*) AS requests,
           COALESCE(SUM(r.status = 'failed'), 0) AS failed, COALESCE(SUM(r.input), 0) AS input, COALESCE(SUM(r.cache_read), 0) AS cache_read,
           COALESCE(SUM(r.cache_write), 0) AS cache_write, COALESCE(SUM(r.output), 0) AS output
         FROM ${FROM_SQL} WHERE ${where} GROUP BY start, key ORDER BY start`,
      ).all(...filter.params),
    )
    const merged = new Map<string, ChartView['buckets'][number]>()
    for (const row of rawBuckets) {
      const key = row.key !== null && leading.has(row.key) ? row.key : OTHER_KEY
      const id = `${String(row.start)}|${key}`
      const previous = merged.get(id)
      merged.set(id, {
        start: row.start,
        key,
        cost: (previous?.cost ?? 0) + row.cost,
        requests: (previous?.requests ?? 0) + row.requests,
        failed: (previous?.failed ?? 0) + row.failed,
        input: (previous?.input ?? 0) + row.input,
        cacheRead: (previous?.cacheRead ?? 0) + row.cache_read,
        cacheWrite: (previous?.cacheWrite ?? 0) + row.cache_write,
        output: (previous?.output ?? 0) + row.output,
      })
    }

    const latencyRows = z.array(latencyRowSchema).parse(
      prepare(
        `SELECT ${bucketSql} AS start, r.ttft_ms, CASE WHEN r.ended_at IS NULL THEN NULL ELSE r.ended_at - r.started_at END AS duration_ms
           FROM ${FROM_SQL} WHERE ${where} AND r.status = 'ok' ORDER BY start`,
      ).all(...filter.params),
    )
    const latencyByBucket = new Map<number, { ttft: number[]; duration: number[] }>()
    for (const row of latencyRows) {
      const entry = latencyByBucket.get(row.start) ?? { ttft: [], duration: [] }
      if (row.ttft_ms !== null) entry.ttft.push(row.ttft_ms)
      if (row.duration_ms !== null) entry.duration.push(row.duration_ms)
      latencyByBucket.set(row.start, entry)
    }
    const latency = [...latencyByBucket.entries()].map(([start, entry]) => {
      const ttft = entry.ttft.sort((left, right) => left - right)
      const duration = entry.duration.sort((left, right) => left - right)
      return {
        start,
        ttftP50: percentile(ttft, 0.5),
        ttftP90: percentile(ttft, 0.9),
        durationP50: percentile(duration, 0.5),
        durationP90: percentile(duration, 0.9),
      }
    })

    const topThreads = z
      .array(threadRowSchema)
      .parse(
        prepare(
          `SELECT r.session_id, s.title, s.project, COALESCE(SUM(${COST_SQL}), 0) AS cost, COUNT(*) AS requests
           FROM ${FROM_SQL} WHERE ${where} GROUP BY r.session_id ORDER BY cost DESC, requests DESC LIMIT 10`,
        ).all(...filter.params),
      )
      .map(row => ({ sessionId: row.session_id, title: row.title, project: row.project, cost: row.cost, requests: row.requests }))

    const current = summaryOf(filter)
    const span = query.to - query.from
    const previous = summaryOf(rangeFilter({ from: query.from - span, to: query.from, purposes: query.purposes }))
    return {
      summary: {
        cost: current.cost,
        requests: current.requests,
        failed: current.failed,
        aborted: current.aborted,
        input: current.input,
        cacheRead: current.cache_read,
        cacheWrite: current.cache_write,
        output: current.output,
        unpriced: current.unpriced,
        cacheSavings: current.cacheSavings,
        turns: current.turns,
        previous: {
          cost: previous.cost,
          requests: previous.requests,
          tokens: previous.input + previous.cache_read + previous.cache_write + previous.output,
          cacheSavings: previous.cacheSavings,
          turns: previous.turns,
        },
      },
      keys,
      buckets: [...merged.values()],
      breakdown: byDimension,
      latency,
      topThreads,
    }
  }

  const recordJevUsage = (record: JevUsageRecord): void => {
    prepare(
      `INSERT OR IGNORE INTO jev_requests (request_id, source, started_at, duration_ms, outcome, input_tokens, output_tokens, credential)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.requestId,
      record.source,
      Math.round(record.startedAt),
      record.durationMs,
      record.outcome,
      record.inputTokens,
      record.outputTokens,
      record.credential,
    )
  }

  const jevUsage = (query: JevUsageQuery): JevUsageView => {
    const rows = prepare(
      `SELECT credential, COALESCE(SUM(source = 'backlog'), 0) AS backlogCalls, COALESCE(SUM(source = 'memory'), 0) AS memoryCalls, COUNT(*) AS calls,
         COALESCE(SUM(outcome = 'success'), 0) AS succeeded,
         COALESCE(SUM(outcome = 'failure'), 0) AS failed,
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(input_tokens IS NULL), 0) AS callsWithoutInputUsage
       FROM jev_requests WHERE started_at >= ? AND started_at < ? GROUP BY credential ORDER BY credential LIMIT 19`,
    )
      .all(query.from, query.to)
      .map(row =>
        z
          .object({
            credential: jevCredentialLabelSchema.or(z.literal('Other credentials')),
            backlogCalls: z.number().int().nonnegative(),
            memoryCalls: z.number().int().nonnegative(),
            calls: z.number().int().nonnegative(),
            succeeded: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
            inputTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
            callsWithoutInputUsage: z.number().int().nonnegative(),
          })
          .strict()
          .parse(row),
      )
    const byCredential: JevUsageBreakdown[] = rows.map(row => ({
      credential: row.credential,
      backlogCalls: row.backlogCalls,
      memoryCalls: row.memoryCalls,
      calls: row.calls,
      succeeded: row.succeeded,
      failed: row.failed,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      callsWithoutInputUsage: row.callsWithoutInputUsage,
      estimatedCostUsd: (row.inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000,
    }))
    const omitted = z
      .object({
        calls: z.number().int().nonnegative(),
        backlogCalls: z.number().int().nonnegative(),
        memoryCalls: z.number().int().nonnegative(),
        succeeded: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        callsWithoutInputUsage: z.number().int().nonnegative(),
      })
      .parse(
        prepare(
          `SELECT COUNT(*) AS calls, COALESCE(SUM(source = 'backlog'), 0) AS backlogCalls, COALESCE(SUM(source = 'memory'), 0) AS memoryCalls,
             COALESCE(SUM(outcome = 'success'), 0) AS succeeded, COALESCE(SUM(outcome = 'failure'), 0) AS failed,
             COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
             COALESCE(SUM(input_tokens IS NULL), 0) AS callsWithoutInputUsage
           FROM jev_requests WHERE started_at >= ? AND started_at < ? AND credential NOT IN (SELECT credential FROM jev_requests
             WHERE started_at >= ? AND started_at < ? GROUP BY credential ORDER BY credential LIMIT 19)`,
        ).get(query.from, query.to, query.from, query.to),
      )
    if (omitted.calls > 0)
      byCredential.push({
        credential: 'Other credentials',
        backlogCalls: omitted.backlogCalls,
        memoryCalls: omitted.memoryCalls,
        calls: omitted.calls,
        succeeded: omitted.succeeded,
        failed: omitted.failed,
        inputTokens: omitted.inputTokens,
        outputTokens: omitted.outputTokens,
        callsWithoutInputUsage: omitted.callsWithoutInputUsage,
        estimatedCostUsd: (omitted.inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000,
      })
    const totals = {
      calls: 0,
      succeeded: 0,
      failed: 0,
      inputTokens: 0,
      outputTokens: 0,
      callsWithoutInputUsage: 0,
    }
    for (const row of byCredential) {
      totals.calls += row.calls
      totals.succeeded += row.succeeded
      totals.failed += row.failed
      totals.inputTokens += row.inputTokens
      totals.outputTokens += row.outputTokens
      totals.callsWithoutInputUsage += row.callsWithoutInputUsage
    }
    return { ...totals, estimatedCostUsd: (totals.inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000, byCredential }
  }

  const syncToolSources = (sources: ReadonlyMap<string, { readonly category: RegistryToolSource; readonly owner: string | null }>): void => {
    transaction(() => {
      for (const [name, source] of sources)
        prepare("UPDATE tools SET category = ?, owner = ? WHERE name = ? AND category != 'skill'").run(source.category, source.owner, name)
    })
  }

  const activity = (query: {
    readonly from: number
    readonly to: number
    readonly category?: 'api' | 'mcp' | 'plugin' | 'tool' | 'skill' | 'other'
    readonly limit?: number
    readonly eventLimit?: number
    /** Timeline bucket; defaults to a local day. */
    readonly bucket?: 'hour' | 'day'
    readonly tzOffsetMinutes?: number
  }) => {
    const bucketMs = query.bucket === 'hour' ? 3_600_000 : 86_400_000
    const offsetMs = (query.tzOffsetMinutes ?? 0) * 60_000
    const timelineBucketSql = `((started_at + ${String(offsetMs)}) / ${String(bucketMs)}) * ${String(bucketMs)} - ${String(offsetMs)}`
    const toolRows = z.array(toolActivityRowSchema).parse(
      prepare(`WITH durations AS (
        SELECT category, owner, name, ended_at - started_at AS duration_ms,
          ROW_NUMBER() OVER (PARTITION BY category, owner, name ORDER BY ended_at - started_at) AS rank,
          COUNT(*) OVER (PARTITION BY category, owner, name) AS count
        FROM tools WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL AND (? IS NULL OR category = ?)
      ), duration_stats AS (
        SELECT category, owner, name,
          MAX(CASE WHEN rank = CAST(count * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50DurationMs,
          MAX(CASE WHEN rank = CAST(count * 0.9 AS INTEGER) + 1 THEN duration_ms END) AS p90DurationMs
        FROM durations GROUP BY category, owner, name
      )
      SELECT t.name, t.category, t.owner, COUNT(*) AS calls,
        SUM(CASE WHEN t.outcome = 'success' THEN 1 ELSE 0 END) AS successes,
        SUM(CASE WHEN t.outcome = 'error' THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN t.outcome = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
        SUM(CASE WHEN t.outcome = 'unknown' THEN 1 ELSE 0 END) AS unknown,
        SUM(CASE WHEN t.outcome = 'pending' THEN 1 ELSE 0 END) AS pending,
        MIN(t.started_at) AS firstStartedAt, MAX(t.started_at) AS lastStartedAt,
        MIN(t.ended_at) AS firstEndedAt, MAX(t.ended_at) AS lastEndedAt,
        AVG(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END) AS averageDurationMs,
        COALESCE(SUM(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END), 0) AS totalDurationMs,
        ds.p50DurationMs, ds.p90DurationMs,
        MAX(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END) AS maxDurationMs,
        COALESCE(SUM(t.result_chars), 0) AS resultChars,
        CAST((COALESCE(SUM(t.result_chars), 0) + 3) / 4 AS INTEGER) AS outputTokens,
        SUM(CASE WHEN t.result_chars IS NOT NULL THEN 1 ELSE 0 END) AS measuredCalls
      FROM tools t LEFT JOIN duration_stats ds ON ds.category = t.category AND ds.owner IS t.owner AND ds.name = t.name
      WHERE t.started_at >= ? AND t.started_at < ? AND (? IS NULL OR t.category = ?)
      GROUP BY t.category, t.owner, t.name ORDER BY calls DESC, t.category, t.owner, t.name LIMIT ?`).all(
        query.from,
        query.to,
        query.category ?? null,
        query.category ?? null,
        query.from,
        query.to,
        query.category ?? null,
        query.category ?? null,
        query.limit ?? 100,
      ),
    )
    const identifierRows = (column: 'normalized_command' | 'test_runner') =>
      z.array(identifierActivityRowSchema).parse(
        prepare(`SELECT ${column} AS identifier, COUNT(*) AS calls,
            COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at END), 0) AS totalDurationMs,
            SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS successes,
            SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
            SUM(CASE WHEN outcome = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
            SUM(CASE WHEN outcome = 'unknown' THEN 1 ELSE 0 END) AS unknown,
            SUM(CASE WHEN outcome = 'pending' THEN 1 ELSE 0 END) AS pending
          FROM tools WHERE started_at >= ? AND started_at < ? AND ${column} IS NOT NULL AND (? IS NULL OR category = ?)
          GROUP BY ${column} ORDER BY totalDurationMs DESC, calls DESC, identifier LIMIT 10`).all(
          query.from,
          query.to,
          query.category ?? null,
          query.category ?? null,
        ),
      )
    const commandRows = identifierRows('normalized_command')
    const testRunRows = identifierRows('test_runner')
    const identifierDurationTotal = (column: 'normalized_command' | 'test_runner') =>
      durationTotalSchema.parse(
        prepare(`SELECT COALESCE(SUM(ended_at - started_at), 0) AS totalDurationMs FROM tools
          WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL AND ${column} IS NOT NULL AND (? IS NULL OR category = ?)`).get(
          query.from,
          query.to,
          query.category ?? null,
          query.category ?? null,
        ),
      ).totalDurationMs
    const commandDurationTotalMs = identifierDurationTotal('normalized_command')
    const testRunDurationTotalMs = identifierDurationTotal('test_runner')
    const events = [
      ...z
        .array(jevEventRowSchema)
        .parse(
          prepare(
            'SELECT started_at AS at, started_at + duration_ms AS endedAt, duration_ms AS durationMs, source, outcome FROM jev_requests WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC LIMIT ?',
          ).all(query.from, query.to, query.eventLimit ?? 200),
        )
        .map(row => ({ kind: 'jev' as const, ...row })),
      ...z
        .array(
          z.object({
            id: z.string(),
            session_id: z.string(),
            seq: z.number(),
            turn: z.number().nullable(),
            step: z.number().nullable(),
            name: z.string(),
            category: z.enum(['api', 'mcp', 'plugin', 'tool', 'skill', 'other']),
            owner: textColumn,
            started_at: z.number(),
            ended_at: numberColumn,
            outcome: z.enum(['success', 'error', 'interrupted', 'unknown', 'pending']),
          }),
        )
        .parse(
          prepare(`SELECT id, session_id, seq, turn, step, name, category, owner, started_at, ended_at, outcome FROM tools
          WHERE started_at >= ? AND started_at < ?
          ORDER BY started_at DESC LIMIT ?`).all(query.from, query.to, query.eventLimit ?? 200),
        )
        .map(row => ({
          kind: 'tool' as const,
          at: row.started_at,
          endedAt: row.ended_at,
          durationMs: row.ended_at === null ? null : row.ended_at - row.started_at,
          category: row.category,
          name: row.name,
          owner: row.owner,
          outcome: row.outcome,
          turn: row.turn,
          step: row.step,
        })),
    ]
      .sort((left, right) => right.at - left.at)
      .slice(0, query.eventLimit ?? 50)
    const categoryOutcomes = z
      .array(activityCategoryRowSchema)
      .parse(
        prepare(`WITH durations AS (
      SELECT category, ended_at - started_at AS duration_ms,
        ROW_NUMBER() OVER (PARTITION BY category ORDER BY ended_at - started_at) AS rank,
        COUNT(*) OVER (PARTITION BY category) AS count
      FROM tools WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL
    ), duration_stats AS (
      SELECT category,
        MAX(CASE WHEN rank = CAST(count * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50DurationMs,
        MAX(CASE WHEN rank = CAST(count * 0.9 AS INTEGER) + 1 THEN duration_ms END) AS p90DurationMs
      FROM durations GROUP BY category
    )
    SELECT t.category, COUNT(*) AS calls,
      SUM(CASE WHEN t.outcome = 'success' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN t.outcome = 'error' THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN t.outcome = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
      SUM(CASE WHEN t.outcome = 'unknown' THEN 1 ELSE 0 END) AS unknown,
      SUM(CASE WHEN t.outcome = 'pending' THEN 1 ELSE 0 END) AS pending,
      AVG(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END) AS averageDurationMs,
      ds.p50DurationMs, ds.p90DurationMs,
      MAX(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END) AS maxDurationMs,
      COALESCE(SUM(t.result_chars), 0) AS resultChars,
      CAST((COALESCE(SUM(t.result_chars), 0) + 3) / 4 AS INTEGER) AS outputTokens,
      SUM(CASE WHEN t.result_chars IS NOT NULL THEN 1 ELSE 0 END) AS measuredCalls
    FROM tools t LEFT JOIN duration_stats ds ON ds.category = t.category
    WHERE t.started_at >= ? AND t.started_at < ? GROUP BY t.category ORDER BY t.category`).all(query.from, query.to, query.from, query.to),
      )
      .map(row => ({
        category: row.category,
        calls: row.calls,
        successes: row.successes,
        errors: row.errors,
        interrupted: row.interrupted,
        unknown: row.unknown,
        pending: row.pending,
        successRate: row.calls === 0 ? 0 : row.successes / row.calls,
        outputTokens: row.outputTokens,
        measuredCalls: row.measuredCalls,
        durationMs: {
          averageMs: row.averageDurationMs === null ? null : Math.round(row.averageDurationMs),
          p50Ms: row.p50DurationMs,
          p90Ms: row.p90DurationMs,
          maxMs: row.maxDurationMs,
        },
      }))
    const timeline = z.array(timelineRowSchema).parse(
      prepare(`SELECT ${timelineBucketSql} AS start, category, COUNT(*) AS calls,
          SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
          COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at END), 0) AS durationMs,
          CAST((COALESCE(SUM(result_chars), 0) + 3) / 4 AS INTEGER) AS outputTokens
        FROM tools WHERE started_at >= ? AND started_at < ? AND (? IS NULL OR category = ?)
        GROUP BY start, category ORDER BY start, category`).all(query.from, query.to, query.category ?? null, query.category ?? null),
    )
    const totals = activityTotalsRowSchema.parse(
      prepare(`SELECT COUNT(*) AS calls,
        COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS successes,
        COALESCE(SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END), 0) AS errors,
        COALESCE(SUM(CASE WHEN outcome = 'interrupted' THEN 1 ELSE 0 END), 0) AS interrupted,
        COALESCE(SUM(CASE WHEN outcome = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown,
        COALESCE(SUM(CASE WHEN outcome = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at END), 0) AS durationMs,
        CAST((COALESCE(SUM(result_chars), 0) + 3) / 4 AS INTEGER) AS outputTokens,
        COALESCE(SUM(CASE WHEN result_chars IS NOT NULL THEN 1 ELSE 0 END), 0) AS measuredCalls
      FROM tools WHERE started_at >= ? AND started_at < ? AND (? IS NULL OR category = ?)`).get(
        query.from,
        query.to,
        query.category ?? null,
        query.category ?? null,
      ),
    )
    const jev = jevActivityRowSchema.parse(
      prepare(`SELECT COUNT(*) AS calls,
      COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS successes,
      COALESCE(SUM(CASE WHEN outcome != 'success' THEN 1 ELSE 0 END), 0) AS failures,
      COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
      AVG(duration_ms) AS durationMs, MAX(duration_ms) AS maxDurationMs FROM jev_requests WHERE started_at >= ? AND started_at < ?`).get(query.from, query.to),
    )
    const jevOutcomes = z
      .array(jevOutcomeRowSchema)
      .parse(
        prepare(
          'SELECT outcome, COUNT(*) AS calls FROM jev_requests WHERE started_at >= ? AND started_at < ? GROUP BY outcome ORDER BY calls DESC, outcome',
        ).all(query.from, query.to),
      )
    const jevSources = z
      .array(
        z.object({
          source: jevUsageSourceSchema,
          calls: z.number(),
          successes: z.number(),
          failures: z.number(),
          inputTokens: z.number(),
          outputTokens: z.number(),
          averageDurationMs: numberColumn,
          p50DurationMs: numberColumn,
          p90DurationMs: numberColumn,
          maxDurationMs: numberColumn,
        }),
      )
      .parse(
        prepare(`WITH durations AS (
      SELECT source, duration_ms,
        ROW_NUMBER() OVER (PARTITION BY source ORDER BY duration_ms) AS rank,
        COUNT(*) OVER (PARTITION BY source) AS count
      FROM jev_requests WHERE started_at >= ? AND started_at < ?
    ), duration_stats AS (
      SELECT source,
        MAX(CASE WHEN rank = CAST(count * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50DurationMs,
        MAX(CASE WHEN rank = CAST(count * 0.9 AS INTEGER) + 1 THEN duration_ms END) AS p90DurationMs
      FROM durations GROUP BY source
    )
    SELECT j.source, COUNT(*) AS calls,
      SUM(CASE WHEN j.outcome = 'success' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN j.outcome != 'success' THEN 1 ELSE 0 END) AS failures,
      COALESCE(SUM(j.input_tokens), 0) AS inputTokens, COALESCE(SUM(j.output_tokens), 0) AS outputTokens,
      AVG(j.duration_ms) AS averageDurationMs, ds.p50DurationMs, ds.p90DurationMs, MAX(j.duration_ms) AS maxDurationMs
    FROM jev_requests j LEFT JOIN duration_stats ds ON ds.source = j.source
    WHERE j.started_at >= ? AND j.started_at < ? GROUP BY j.source ORDER BY j.source`).all(query.from, query.to, query.from, query.to),
      )
      .map(row => ({
        source: row.source,
        calls: row.calls,
        successes: row.successes,
        failures: row.failures,
        successRate: row.calls === 0 ? 0 : row.successes / row.calls,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        durationMs: {
          averageMs: row.averageDurationMs === null ? null : Math.round(row.averageDurationMs),
          p50Ms: row.p50DurationMs,
          p90Ms: row.p90DurationMs,
          maxMs: row.maxDurationMs,
        },
      }))
    const jevDurationStats = z.object({ p50DurationMs: numberColumn, p90DurationMs: numberColumn, maxDurationMs: numberColumn }).parse(
      prepare(`WITH durations AS (
      SELECT duration_ms, ROW_NUMBER() OVER (ORDER BY duration_ms) AS rank, COUNT(*) OVER () AS count
      FROM jev_requests WHERE started_at >= ? AND started_at < ?
    )
    SELECT MAX(CASE WHEN rank = CAST(count * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50DurationMs,
      MAX(CASE WHEN rank = CAST(count * 0.9 AS INTEGER) + 1 THEN duration_ms END) AS p90DurationMs,
      MAX(duration_ms) AS maxDurationMs
    FROM durations`).get(query.from, query.to),
    )

    return {
      range: { from: query.from, to: query.to },
      timelineBucket: query.bucket ?? 'day',
      categories: categoryOutcomes.map(row => ({ category: row.category, calls: row.calls, outputTokens: row.outputTokens })),
      categoryOutcomes,
      timeline,
      totals: {
        ...totals,
        successRate: totals.calls === 0 ? 0 : totals.successes / totals.calls,
      },
      tools: toolRows.map(row => ({
        name: row.name,
        category: row.category,
        owner: row.owner,
        calls: row.calls,
        successes: row.successes,
        successRate: row.calls === 0 ? 0 : row.successes / row.calls,
        errors: row.errors,
        interrupted: row.interrupted,
        unknown: row.unknown,
        pending: row.pending,
        outcomes: { successes: row.successes, errors: row.errors, interrupted: row.interrupted, unknown: row.unknown, pending: row.pending },
        timestamps: { firstStarted: row.firstStartedAt, lastStarted: row.lastStartedAt, firstEnded: row.firstEndedAt, lastEnded: row.lastEndedAt },
        durationMs: {
          averageMs: row.averageDurationMs === null ? null : Math.round(row.averageDurationMs),
          p50Ms: row.p50DurationMs,
          p90Ms: row.p90DurationMs,
          maxMs: row.maxDurationMs,
        },
        averageDurationMs: row.averageDurationMs === null ? null : Math.round(row.averageDurationMs),
        totalDurationMs: row.totalDurationMs,
        outputTokens: row.outputTokens,
        measuredCalls: row.measuredCalls,
      })),
      commandDurationTotalMs,
      testRunDurationTotalMs,
      commandDistribution: commandRows.map(row => ({ command: row.identifier, calls: row.calls, totalDurationMs: row.totalDurationMs })),
      testRunDistribution: testRunRows.map(row => ({
        runner: row.identifier,
        calls: row.calls,
        totalDurationMs: row.totalDurationMs,
        successes: row.successes,
        errors: row.errors,
        interrupted: row.interrupted,
        unknown: row.unknown,
        pending: row.pending,
      })),
      events,
      jev: {
        calls: jev.calls,
        successes: jev.successes,
        failures: jev.failures,
        averageDurationMs: jev.durationMs === null ? null : Math.round(jev.durationMs),
        inputTokens: jev.inputTokens,
        outputTokens: jev.outputTokens,
        byOutcome: jevOutcomes,
        successRate: jev.calls === 0 ? 0 : jev.successes / jev.calls,
        bySource: jevSources,
        durationMs: {
          averageMs: jev.durationMs === null ? null : Math.round(jev.durationMs),
          p50Ms: jevDurationStats.p50DurationMs,
          p90Ms: jevDurationStats.p90DurationMs,
          maxMs: jevDurationStats.maxDurationMs,
        },
      },
    }
  }

  const otelMetrics = (range: { readonly from: number; readonly to: number; readonly temporality: OtlpTemporality; readonly serviceName: string }) => {
    const modelCountRows = z
      .array(
        z.object({
          provider: z.string().max(200),
          model: z.string().max(200),
          purpose: z.enum(UsageFoldModel.REQUEST_PURPOSES),
          status: z.enum(UsageFoldModel.REQUEST_STATUSES),
          calls: z.number().int(),
        }),
      )
      .parse(
        prepare(`SELECT provider, model, purpose, status, COUNT(*) AS calls FROM requests r
          WHERE ${VISIBLE_SQL} AND r.started_at >= ? AND r.started_at < ?
          GROUP BY provider, model, purpose, status ORDER BY calls DESC LIMIT 1000`).all(range.from, range.to),
      )
    const modelTokenRows = z
      .array(
        z.object({
          provider: z.string().max(200),
          model: z.string().max(200),
          purpose: z.enum(UsageFoldModel.REQUEST_PURPOSES),
          input: z.number().int(),
          cacheRead: z.number().int(),
          cacheWrite: z.number().int(),
          output: z.number().int(),
          reasoning: z.number().int(),
        }),
      )
      .parse(
        prepare(`SELECT provider, model, purpose, COALESCE(SUM(input), 0) AS input,
            COALESCE(SUM(cache_read), 0) AS cacheRead, COALESCE(SUM(cache_write), 0) AS cacheWrite,
            COALESCE(SUM(output), 0) AS output, COALESCE(SUM(reasoning), 0) AS reasoning
          FROM requests r WHERE ${VISIBLE_SQL} AND r.started_at >= ? AND r.started_at < ?
          GROUP BY provider, model, purpose ORDER BY SUM(COALESCE(input, 0) + COALESCE(cache_read, 0) + COALESCE(cache_write, 0) + COALESCE(output, 0) + COALESCE(reasoning, 0)) DESC LIMIT 1000`).all(
          range.from,
          range.to,
        ),
      )
    const modelDurationRows = z
      .array(
        z
          .object({
            provider: z.string().max(200),
            model: z.string().max(200),
            purpose: z.enum(UsageFoldModel.REQUEST_PURPOSES),
            status: z.enum(UsageFoldModel.REQUEST_STATUSES),
          })
          .extend(OTEL_HISTOGRAM_BASE_ROW_SCHEMA.shape),
      )
      .parse(
        prepare(`WITH duration_rows AS (
            SELECT provider, model, purpose, status, ended_at - started_at AS duration_ms FROM requests r
            WHERE ${VISIBLE_SQL} AND r.started_at >= ? AND r.started_at < ? AND r.ended_at IS NOT NULL AND r.ended_at >= r.started_at
          )
          SELECT provider, model, purpose, status, COUNT(*) AS calls, SUM(duration_ms) AS durationSumMs, ${OTEL_BUCKET_SELECT}
          FROM duration_rows GROUP BY provider, model, purpose, status ORDER BY calls DESC LIMIT 1000`).all(range.from, range.to),
      )
    const toolCategoryRows = z.array(z.object({ category: z.enum(OTEL_TOOL_CATEGORIES), outcome: z.enum(OTEL_TOOL_OUTCOMES), calls: z.number().int() })).parse(
      prepare(`SELECT category, outcome, COUNT(*) AS calls FROM tools WHERE started_at >= ? AND started_at < ?
          GROUP BY category, outcome ORDER BY category, outcome`).all(range.from, range.to),
    )
    const toolSourceRows = z
      .array(z.object({ category: z.enum(OTEL_TOOL_CATEGORIES), name: z.string().min(1).max(120), owner: textColumn, calls: z.number().int() }))
      .parse(
        prepare(`SELECT category, name, owner, COUNT(*) AS calls FROM tools WHERE started_at >= ? AND started_at < ?
          GROUP BY category, name, owner ORDER BY calls DESC, category, owner, name LIMIT 500`).all(range.from, range.to),
      )
    const toolDurationRows = z
      .array(z.object({ category: z.enum(OTEL_TOOL_CATEGORIES), outcome: z.enum(OTEL_TOOL_OUTCOMES) }).extend(OTEL_HISTOGRAM_BASE_ROW_SCHEMA.shape))
      .parse(
        prepare(`WITH duration_rows AS (
            SELECT category, outcome, ended_at - started_at AS duration_ms FROM tools
            WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL AND ended_at >= started_at
          )
          SELECT category, outcome, COUNT(*) AS calls, SUM(duration_ms) AS durationSumMs, ${OTEL_BUCKET_SELECT}
          FROM duration_rows GROUP BY category, outcome ORDER BY category, outcome`).all(range.from, range.to),
      )
    const jevCountRows = z.array(z.object({ source: jevUsageSourceSchema, outcome: jevUsageOutcomeSchema, calls: z.number().int() })).parse(
      prepare(`SELECT source, outcome, COUNT(*) AS calls FROM jev_requests WHERE started_at >= ? AND started_at < ?
          GROUP BY source, outcome ORDER BY source, outcome`).all(range.from, range.to),
    )
    const jevTokenRows = z.array(z.object({ source: jevUsageSourceSchema, input: z.number().int(), output: z.number().int() })).parse(
      prepare(`SELECT source, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output
          FROM jev_requests WHERE started_at >= ? AND started_at < ? GROUP BY source ORDER BY source`).all(range.from, range.to),
    )
    const jevDurationRows = z
      .array(z.object({ source: jevUsageSourceSchema, outcome: jevUsageOutcomeSchema }).extend(OTEL_HISTOGRAM_BASE_ROW_SCHEMA.shape))
      .parse(
        prepare(`WITH duration_rows AS (
            SELECT source, outcome, duration_ms FROM jev_requests WHERE started_at >= ? AND started_at < ?
          )
          SELECT source, outcome, COUNT(*) AS calls, SUM(duration_ms) AS durationSumMs, ${OTEL_BUCKET_SELECT}
          FROM duration_rows GROUP BY source, outcome ORDER BY source, outcome`).all(range.from, range.to),
      )

    const counters: OtlpCounterInput[] = []
    if (modelCountRows.length > 0)
      counters.push({
        name: 'dsh.model.request.count',
        description: 'Recorded model requests by provider, model, purpose, and outcome.',
        unit: '{request}',
        points: modelCountRows.map(row => ({
          attributes: {
            'gen_ai.provider.name': row.provider,
            'gen_ai.request.model': row.model,
            'dsh.request.purpose': row.purpose,
            'dsh.request.outcome': row.status,
          },
          value: row.calls,
        })),
      })
    const tokenPoints = modelTokenRows.flatMap(row =>
      [
        { type: 'input', value: row.input },
        { type: 'cache_read', value: row.cacheRead },
        { type: 'cache_write', value: row.cacheWrite },
        { type: 'output', value: row.output },
        { type: 'reasoning', value: row.reasoning },
      ]
        .filter(token => token.value > 0)
        .map(token => ({
          attributes: {
            'gen_ai.provider.name': row.provider,
            'gen_ai.request.model': row.model,
            'dsh.request.purpose': row.purpose,
            'gen_ai.token.type': token.type,
          },
          value: token.value,
        })),
    )
    if (tokenPoints.length > 0)
      counters.push({ name: 'dsh.model.token.usage', description: 'Recorded model tokens by token type.', unit: '{token}', points: tokenPoints })
    if (toolCategoryRows.length > 0)
      counters.push({
        name: 'dsh.tool.execution.count',
        description: 'Recorded tool executions by source category and outcome; exact for the selected interval.',
        unit: '{execution}',
        points: toolCategoryRows.map(row => ({ attributes: { 'dsh.tool.category': row.category, 'dsh.tool.outcome': row.outcome }, value: row.calls })),
      })
    if (toolSourceRows.length > 0)
      counters.push({
        name: 'dsh.tool.source.execution.count',
        description: 'Recorded tool executions for up to the 500 most-used named tool sources; category totals are exported separately.',
        unit: '{execution}',
        points: toolSourceRows.map(row => {
          const point = {
            attributes: { 'dsh.tool.category': row.category, 'dsh.tool.name': row.name },
            value: row.calls,
          }
          if (row.owner === null) return point
          return { attributes: { ...point.attributes, 'dsh.tool.owner': row.owner }, value: point.value }
        }),
      })
    if (jevCountRows.length > 0)
      counters.push({
        name: 'dsh.jev.request.count',
        description: 'Recorded Jev requests by calling plugin and outcome.',
        unit: '{request}',
        points: jevCountRows.map(row => ({ attributes: { 'dsh.jev.source': row.source, 'dsh.jev.outcome': row.outcome }, value: row.calls })),
      })
    const jevTokenPoints = jevTokenRows.flatMap(row =>
      [
        { type: 'input', value: row.input },
        { type: 'output', value: row.output },
      ]
        .filter(token => token.value > 0)
        .map(token => ({ attributes: { 'dsh.jev.source': row.source, 'gen_ai.token.type': token.type }, value: token.value })),
    )
    if (jevTokenPoints.length > 0)
      counters.push({
        name: 'dsh.jev.token.usage',
        description: 'Provider-reported Jev tokens by calling plugin and token type.',
        unit: '{token}',
        points: jevTokenPoints,
      })

    const bucketCountsOf = (row: z.infer<typeof OTEL_HISTOGRAM_BASE_ROW_SCHEMA>): number[] => {
      const cumulative = [
        row.bucket0,
        row.bucket1,
        row.bucket2,
        row.bucket3,
        row.bucket4,
        row.bucket5,
        row.bucket6,
        row.bucket7,
        row.bucket8,
        row.bucket9,
        row.bucket10,
        row.bucket11,
        row.bucket12,
        row.calls,
      ]
      return cumulative.map((value, index) => value - (cumulative[index - 1] ?? 0))
    }
    const histograms: OtlpHistogramInput[] = []
    if (modelDurationRows.length > 0)
      histograms.push({
        name: 'dsh.model.request.duration',
        description: 'Recorded model request duration distribution.',
        unit: 's',
        bounds: OTEL_DURATION_BOUNDS_SECONDS,
        points: modelDurationRows.map(row => ({
          attributes: {
            'gen_ai.provider.name': row.provider,
            'gen_ai.request.model': row.model,
            'dsh.request.purpose': row.purpose,
            'dsh.request.outcome': row.status,
          },
          count: row.calls,
          sum: row.durationSumMs / 1_000,
          bucketCounts: bucketCountsOf(row),
        })),
      })
    if (toolDurationRows.length > 0)
      histograms.push({
        name: 'dsh.tool.execution.duration',
        description: 'Recorded tool execution duration distribution by category and outcome.',
        unit: 's',
        bounds: OTEL_DURATION_BOUNDS_SECONDS,
        points: toolDurationRows.map(row => ({
          attributes: { 'dsh.tool.category': row.category, 'dsh.tool.outcome': row.outcome },
          count: row.calls,
          sum: row.durationSumMs / 1_000,
          bucketCounts: bucketCountsOf(row),
        })),
      })
    if (jevDurationRows.length > 0)
      histograms.push({
        name: 'dsh.jev.request.duration',
        description: 'Recorded Jev request duration distribution by calling plugin and outcome.',
        unit: 's',
        bounds: OTEL_DURATION_BOUNDS_SECONDS,
        points: jevDurationRows.map(row => ({
          attributes: { 'dsh.jev.source': row.source, 'dsh.jev.outcome': row.outcome },
          count: row.calls,
          sum: row.durationSumMs / 1_000,
          bucketCounts: bucketCountsOf(row),
        })),
      })

    return createOtlpMetricsRequest({
      from: range.from,
      to: range.to,
      temporality: range.temporality,
      serviceName: range.serviceName,
      counters,
      histograms,
    })
  }

  const counts = () =>
    z
      .object({ files: z.number(), requests: z.number() })
      .parse(prepare(`SELECT (SELECT COUNT(*) FROM files) AS files, (SELECT COUNT(*) FROM requests r WHERE ${VISIBLE_SQL}) AS requests`).get())

  return {
    fileCursor,
    commitLogSlice,
    insertLiveCall,
    reconcileLiveCalls,
    pruneTelemetry: (now?: number) => transaction(() => pruneTelemetry(now)),
    routeBands,
    unratedRouteBands,
    writeRates,
    getMeta,
    setMeta,
    requests,
    charts,
    recordJevUsage,
    jevUsage,
    activity,
    otelMetrics,
    syncToolSources,
    counts,
    close: () => database.close(),
  }
}
