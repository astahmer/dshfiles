import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { z } from 'zod'
import { contextBand } from '@dshfiles/ai-accounts/cost-estimate'
import type { ChartQuery, ChartView, RequestPage, RequestQuery, RequestView } from './api.js'
import { REQUEST_PURPOSES, REQUEST_STATUSES, type RequestRow, type SessionMeta } from './fold.js'

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
const FOLD_VERSION = 1

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
  purpose: z.enum(REQUEST_PURPOSES),
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
  status: z.enum(REQUEST_STATUSES),
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
})

const COST_SQL = `CASE WHEN rr.provider IS NULL OR r.input IS NULL THEN NULL
  ELSE (r.input * rr.input + r.output * rr.output + r.cache_read * rr.cache_read + r.cache_write * rr.cache_write) / 1000000.0 END`

const TOKENS_SQL = 'COALESCE(r.input, 0) + COALESCE(r.cache_read, 0) + COALESCE(r.cache_write, 0) + COALESCE(r.output, 0)'

const FROM_SQL = `requests r
  LEFT JOIN sessions s ON s.id = r.session_id
  LEFT JOIN route_rates rr ON rr.provider = r.provider AND rr.model = r.model AND rr.band = r.band`

/** Hidden: live calls folded into their log row, and live calls still waiting for one. */
const VISIBLE_SQL = "r.merged_into IS NULL AND NOT (r.source = 'live' AND r.settled = 0)"

const SORT_SQL: Readonly<Record<RequestQuery['sort'], string>> = {
  startedAt: 'r.started_at',
  cost: 'cost',
  input: 'r.input',
  cacheRead: 'r.cache_read',
  output: 'r.output',
  durationMs: 'duration_ms',
  ttftMs: 'r.ttft_ms',
}

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
      "DELETE FROM files; DELETE FROM requests WHERE source = 'log'; UPDATE requests SET merged_into = NULL, settled = 0 WHERE purpose IN ('title', 'compaction')",
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

  const upsertRequest = (row: RequestRow, settled: boolean): void => {
    const usage = row.usage
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
      usage === null ? 0 : contextBand(usage.input + usage.cacheRead + usage.cacheWrite),
      row.status,
      row.stopReason,
      row.errorCode,
      settled ? 1 : 0,
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
  }): void =>
    transaction(() => {
      for (const row of slice.rows) upsertRequest(row, true)
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

  const unratedRouteBands = (): RouteBand[] =>
    z.array(z.object({ provider: z.string(), model: z.string(), band: z.number() })).parse(
      prepare(
        `SELECT DISTINCT r.provider, r.model, r.band FROM requests r
           LEFT JOIN route_rates rr ON rr.provider = r.provider AND rr.model = r.model AND rr.band = r.band
           WHERE r.input IS NOT NULL AND rr.provider IS NULL`,
      ).all(),
    )

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
           COALESCE(SUM(r.input IS NOT NULL AND rr.provider IS NULL), 0) AS unpriced
         FROM ${FROM_SQL} WHERE ${filter.clauses.join(' AND ')}`,
      ).get(...filter.params),
    )

  const charts = (query: ChartQuery): ChartView => {
    const filter = rangeFilter(query)
    const where = filter.clauses.join(' AND ')
    const bucketMs = query.bucket === 'hour' ? 3_600_000 : 86_400_000
    const offsetMs = query.tzOffsetMinutes * 60_000
    const bucketSql = `((r.started_at + ${String(offsetMs)}) / ${String(bucketMs)}) * ${String(bucketMs)} - ${String(offsetMs)}`
    const dimensionSql = { model: 'r.model', provider: 'r.provider', project: "COALESCE(s.project, '(none)')" } as const

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
    const ranked = byDimension[query.groupBy]
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
        previous: {
          cost: previous.cost,
          requests: previous.requests,
          tokens: previous.input + previous.cache_read + previous.cache_write + previous.output,
        },
      },
      keys,
      buckets: [...merged.values()],
      breakdown: byDimension,
      latency,
      topThreads,
    }
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
    routeBands,
    unratedRouteBands,
    writeRates,
    getMeta,
    setMeta,
    requests,
    charts,
    counts,
    close: () => database.close(),
  }
}
