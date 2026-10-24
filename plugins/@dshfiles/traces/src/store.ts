import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { z } from 'zod'
import type { NormalizedLog, NormalizedMetricPoint, NormalizedSpan } from './otlp/normalize.js'
import { SpanCost } from './span-cost.js'
import { buildSpanTree } from './span-tree.js'
import { LatencyStats } from './stats.js'
import {
  attributeValueSchema,
  type ErrorGroup,
  type LogList,
  type MetricSeries,
  type MetricSummary,
  type ModelUsage,
  type ServiceMap,
  type SessionSummary,
  type SpanKind,
  type SpanStatus,
  type TraceDetail,
  type TraceList,
  type TraceStats,
} from './types.js'

const MIGRATIONS = [
  `
  CREATE TABLE resources (id TEXT PRIMARY KEY, attributes TEXT NOT NULL) WITHOUT ROWID;
  CREATE TABLE spans (
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    name TEXT NOT NULL,
    service TEXT NOT NULL,
    scope TEXT,
    kind INTEGER NOT NULL,
    start_us INTEGER NOT NULL,
    end_us INTEGER NOT NULL,
    status_code INTEGER NOT NULL,
    status_message TEXT,
    error_type TEXT,
    session_id TEXT,
    attributes TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    events TEXT NOT NULL,
    link_count INTEGER NOT NULL,
    received_ms INTEGER NOT NULL,
    PRIMARY KEY (trace_id, span_id)
  ) WITHOUT ROWID;
  CREATE INDEX spans_start ON spans (start_us);
  CREATE INDEX spans_errors ON spans (status_code, start_us);
  CREATE TABLE traces (
    trace_id TEXT PRIMARY KEY,
    root_name TEXT NOT NULL,
    root_service TEXT NOT NULL,
    start_us INTEGER NOT NULL,
    end_us INTEGER NOT NULL,
    span_count INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    services TEXT NOT NULL,
    session_id TEXT,
    received_ms INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE INDEX traces_start ON traces (start_us, trace_id);
  CREATE INDEX traces_received ON traces (received_ms);
  CREATE INDEX traces_session ON traces (session_id);
  `,
  `
  CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    time_us INTEGER NOT NULL,
    severity_number INTEGER NOT NULL,
    severity_text TEXT,
    body TEXT NOT NULL,
    service TEXT NOT NULL,
    scope TEXT,
    trace_id TEXT,
    span_id TEXT,
    event_name TEXT,
    attributes TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    received_ms INTEGER NOT NULL
  );
  CREATE INDEX logs_time ON logs (time_us, id);
  CREATE INDEX logs_trace ON logs (trace_id, span_id);
  CREATE INDEX logs_received ON logs (received_ms);
  `,
  `
  CREATE TABLE metric_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    service TEXT NOT NULL,
    type TEXT NOT NULL,
    unit TEXT,
    description TEXT,
    monotonic INTEGER NOT NULL,
    temporality TEXT NOT NULL,
    attributes TEXT NOT NULL,
    time_us INTEGER NOT NULL,
    value REAL,
    count REAL,
    sum REAL,
    received_ms INTEGER NOT NULL
  );
  CREATE INDEX metric_points_series ON metric_points (service, name, time_us);
  CREATE INDEX metric_points_received ON metric_points (received_ms);
  `,
  // A subagent's turns join their parent's trace, so a thread's traces are those where any span carries its Session.
  `
  CREATE INDEX spans_session ON spans (session_id, trace_id);
  `,
]

export type Retention = { readonly maxAgeHours: number; readonly maxSpans: number; readonly maxLogs: number; readonly maxMetricPoints: number }

export type TraceListQuery = {
  readonly service?: string | undefined
  readonly operation?: string | undefined
  readonly status?: 'all' | 'error' | 'ok' | undefined
  readonly minDurationMs?: number | undefined
  readonly fromMs?: number | undefined
  readonly toMs?: number | undefined
  readonly search?: string | undefined
  readonly sessionId?: string | undefined
  readonly turn?: number | undefined
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
}

type IngestResult = { readonly stored: number; readonly prunedTraces: number }
type StoreSummary = {
  readonly spans: number
  readonly traces: number
  readonly logs: number
  readonly metricPoints: number
  readonly oldestMs: number | null
  readonly newestMs: number | null
}
type ClearResult = { readonly removedSpans: number; readonly removedTraces: number; readonly removedLogs: number; readonly removedMetricPoints: number }

const MAX_METRIC_SERIES = 20
const MAX_SERIES_POINTS = 500

const metricTypeSchema = z.enum(['gauge', 'sum', 'histogram', 'exponentialHistogram', 'summary'])

export type LogSearchQuery = {
  readonly service?: string | undefined
  readonly minSeverity?: number | undefined
  readonly search?: string | undefined
  readonly attribute?: { readonly key: string; readonly value: string } | undefined
  readonly traceId?: string | undefined
  readonly spanId?: string | undefined
  readonly sessionId?: string | undefined
  readonly fromMs?: number | undefined
  readonly toMs?: number | undefined
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
}

/** Spans that ended after a time, narrowed like an alert rule or a board: service, span name (a trailing * is a prefix), one attribute. */
export type SpanSampleQuery = {
  readonly endedAfterMs: number
  readonly service: string | null
  readonly operation: string | null
  readonly attribute: { readonly key: string; readonly value: string } | null
  readonly groupAttribute?: string | undefined
  readonly measureAttribute?: string | undefined
  readonly limit: number
}

export type SpanSample = {
  readonly traceId: string
  readonly name: string
  readonly service: string
  readonly durationMs: number
  readonly error: boolean
  readonly sessionId: string | null
  readonly group: string | null
  readonly measure: number | null
}

/** Spans longer than this are not looked for: it bounds the start-time index scan of an end-time window. */
const SAMPLE_LOOKBACK_US = 6 * 3_600_000_000

export class TraceStoreError extends Error {
  constructor(
    readonly code: 'invalid-cursor' | 'not-found',
    message: string,
  ) {
    super(message)
    this.name = 'TraceStoreError'
  }
}

const KINDS: readonly SpanKind[] = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer']
const STATUSES: readonly SpanStatus[] = ['unset', 'ok', 'error']

const attributesJsonSchema = z.record(z.string(), attributeValueSchema)
const eventsJsonSchema = z.array(z.object({ name: z.string(), timeUs: z.number(), attributes: attributesJsonSchema }))

const traceRowSchema = z.object({
  trace_id: z.string(),
  root_name: z.string(),
  root_service: z.string(),
  start_us: z.number(),
  end_us: z.number(),
  span_count: z.number(),
  error_count: z.number(),
  services: z.string(),
  session_id: z.string().nullable(),
  cost_usd: z.number().nullable(),
})

const spanRowSchema = z.object({
  span_id: z.string(),
  parent_span_id: z.string().nullable(),
  name: z.string(),
  service: z.string(),
  scope: z.string().nullable(),
  kind: z.number(),
  start_us: z.number(),
  end_us: z.number(),
  status_code: z.number(),
  status_message: z.string().nullable(),
  session_id: z.string().nullable(),
  attributes: z.string(),
  resource: z.string().nullable(),
  events: z.string(),
  link_count: z.number(),
})

const countSchema = z.object({ count: z.number() })

const logRowSchema = z.object({
  id: z.number(),
  time_us: z.number(),
  severity_number: z.number(),
  severity_text: z.string().nullable(),
  body: z.string(),
  service: z.string(),
  scope: z.string().nullable(),
  trace_id: z.string().nullable(),
  span_id: z.string().nullable(),
  event_name: z.string().nullable(),
  attributes: z.string(),
  resource: z.string().nullable(),
})

type LogCursor = { readonly timeUs: number; readonly id: number }

const decodeLogCursor = (cursor: string): LogCursor => {
  const match = /^(\d{1,17}):(\d{1,15})$/.exec(cursor)
  if (match?.[1] === undefined || match[2] === undefined) throw new TraceStoreError('invalid-cursor', 'The logs cursor is invalid.')
  return { timeUs: Number(match[1]), id: Number(match[2]) }
}

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, match => `\\${match}`)

const usToMs = (micros: number): number => micros / 1000

const errorTypeOf = (span: NormalizedSpan): string | null => {
  const direct = span.attributes['error.type']
  if (typeof direct === 'string' && direct.length > 0) return direct
  for (const event of span.events) {
    const type = event.attributes['exception.type']
    if (event.name === 'exception' && typeof type === 'string' && type.length > 0) return type
  }
  return null
}

/** Error messages differ by ids and counts; grouping folds digit runs so one failure mode is one group. */
const messageShape = (message: string | null): string | null => (message === null ? null : message.replace(/\d+/g, '#').slice(0, 160))

const encodeCursor = (startUs: number, traceId: string): string => `${String(startUs)}:${traceId}`

type TraceCursor = { readonly startUs: number; readonly traceId: string }

const decodeCursor = (cursor: string): TraceCursor => {
  const match = /^(\d{1,17}):([0-9a-f]{32})$/.exec(cursor)
  if (match?.[1] === undefined || match[2] === undefined) throw new TraceStoreError('invalid-cursor', 'The traces cursor is invalid.')
  return { startUs: Number(match[1]), traceId: match[2] }
}

export type TraceStore = ReturnType<typeof openTraceStore>

export const openTraceStore = (options: { readonly path: string; readonly now?: () => number }) => {
  const now = options.now ?? Date.now
  if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(options.path)
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
  if (options.path !== ':memory:') for (const file of [options.path, `${options.path}-wal`, `${options.path}-shm`]) if (existsSync(file)) chmodSync(file, 0o600)

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

  const refreshTrace = (traceId: string, receivedMs: number): void => {
    const aggregate = z
      .object({ start_us: z.number(), end_us: z.number(), span_count: z.number(), error_count: z.number(), session_id: z.string().nullable() })
      .parse(
        prepare(
          'SELECT MIN(start_us) AS start_us, MAX(end_us) AS end_us, COUNT(*) AS span_count, SUM(status_code = 2) AS error_count, MAX(session_id) AS session_id FROM spans WHERE trace_id = ?',
        ).get(traceId),
      )
    const root = z.object({ name: z.string(), service: z.string() }).parse(
      prepare(
        `SELECT name, service FROM spans s WHERE s.trace_id = ?
           ORDER BY (s.parent_span_id IS NULL OR NOT EXISTS (SELECT 1 FROM spans p WHERE p.trace_id = s.trace_id AND p.span_id = s.parent_span_id)) DESC, s.start_us
           LIMIT 1`,
      ).get(traceId),
    )
    const services = z
      .array(z.object({ service: z.string() }))
      .parse(prepare('SELECT DISTINCT service FROM spans WHERE trace_id = ? ORDER BY service').all(traceId))
      .map(row => row.service)
    prepare(
      `INSERT OR REPLACE INTO traces (trace_id, root_name, root_service, start_us, end_us, span_count, error_count, services, session_id, received_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      traceId,
      root.name,
      root.service,
      aggregate.start_us,
      aggregate.end_us,
      aggregate.span_count,
      aggregate.error_count,
      JSON.stringify(services),
      aggregate.session_id,
      receivedMs,
    )
  }

  const deleteTraces = (traceIds: readonly string[]): void => {
    for (const traceId of traceIds) {
      prepare('DELETE FROM spans WHERE trace_id = ?').run(traceId)
      prepare('DELETE FROM traces WHERE trace_id = ?').run(traceId)
    }
  }

  const spanCount = (): number => countSchema.parse(prepare('SELECT COUNT(*) AS count FROM spans').get()).count

  /** Retention drops whole traces, oldest received first, so a kept trace never loses part of its tree. */
  const prune = (retention: Retention): number => {
    const cutoff = now() - retention.maxAgeHours * 3_600_000
    const expired = z
      .array(z.object({ trace_id: z.string() }))
      .parse(prepare('SELECT trace_id FROM traces WHERE received_ms < ?').all(cutoff))
      .map(row => row.trace_id)
    let removed = expired.length
    transaction(() => deleteTraces(expired))
    let excess = spanCount() - retention.maxSpans
    if (excess > 0) {
      const oldest = z
        .array(z.object({ trace_id: z.string(), span_count: z.number() }))
        .parse(prepare('SELECT trace_id, span_count FROM traces ORDER BY received_ms, start_us').all())
      const victims: string[] = []
      for (const trace of oldest) {
        if (excess <= 0) break
        victims.push(trace.trace_id)
        excess -= trace.span_count
      }
      removed += victims.length
      transaction(() => deleteTraces(victims))
    }
    const expiredLogs = Number(prepare('DELETE FROM logs WHERE received_ms < ?').run(cutoff).changes)
    const excessLogs = logCount() - retention.maxLogs
    const droppedLogs = excessLogs > 0 ? Number(prepare('DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id LIMIT ?)').run(excessLogs).changes) : 0
    prepare('DELETE FROM metric_points WHERE received_ms < ?').run(cutoff)
    const excessPoints = metricPointCount() - retention.maxMetricPoints
    if (excessPoints > 0) prepare('DELETE FROM metric_points WHERE id IN (SELECT id FROM metric_points ORDER BY id LIMIT ?)').run(excessPoints)
    if (removed > 0 || expiredLogs + droppedLogs > 0)
      prepare('DELETE FROM resources WHERE id NOT IN (SELECT resource_id FROM spans UNION SELECT resource_id FROM logs)').run()
    return removed
  }

  const storeResource = (resource: Readonly<Record<string, unknown>>): string => {
    const resourceJson = JSON.stringify(resource)
    const resourceId = createHash('sha1').update(resourceJson).digest('hex')
    prepare('INSERT OR IGNORE INTO resources (id, attributes) VALUES (?, ?)').run(resourceId, resourceJson)
    return resourceId
  }

  const ingestLogs = (logs: readonly NormalizedLog[], retention: Retention): number => {
    if (logs.length === 0) return 0
    const receivedMs = now()
    transaction(() => {
      for (const log of logs)
        prepare(
          `INSERT INTO logs (time_us, severity_number, severity_text, body, service, scope, trace_id, span_id, event_name, attributes, resource_id, received_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          log.timeUs,
          log.severityNumber,
          log.severityText,
          log.body,
          log.service,
          log.scope,
          log.traceId,
          log.spanId,
          log.eventName,
          JSON.stringify(log.attributes),
          storeResource(log.resource),
          receivedMs,
        )
    })
    prune(retention)
    return logs.length
  }

  const searchLogs = (query: LogSearchQuery): LogList => {
    const limit = query.limit ?? 100
    const conditions: string[] = []
    const parameters: SQLInputValue[] = []
    if (query.service !== undefined) {
      conditions.push('l.service = ?')
      parameters.push(query.service)
    }
    if (query.minSeverity !== undefined) {
      conditions.push('l.severity_number >= ?')
      parameters.push(query.minSeverity)
    }
    if (query.traceId !== undefined) {
      conditions.push('l.trace_id = ?')
      parameters.push(query.traceId.toLowerCase())
    }
    if (query.spanId !== undefined) {
      conditions.push('l.span_id = ?')
      parameters.push(query.spanId.toLowerCase())
    }
    if (query.sessionId !== undefined) {
      conditions.push(`(l.trace_id IN (SELECT trace_id FROM spans WHERE session_id = ?) OR json_extract(l.attributes, '$."dsh.session.id"') = ?)`)
      parameters.push(query.sessionId, query.sessionId)
    }
    if (query.fromMs !== undefined) {
      conditions.push('l.time_us >= ?')
      parameters.push(Math.round(query.fromMs * 1000))
    }
    if (query.toMs !== undefined) {
      conditions.push('l.time_us < ?')
      parameters.push(Math.round(query.toMs * 1000))
    }
    if (query.attribute !== undefined) {
      conditions.push('CAST(json_extract(l.attributes, ?) AS TEXT) = ?')
      parameters.push(`$."${query.attribute.key}"`, query.attribute.value)
    }
    if (query.search !== undefined) {
      const pattern = `%${escapeLike(query.search)}%`
      conditions.push("(l.body LIKE ? ESCAPE '\\' OR l.attributes LIKE ? ESCAPE '\\' OR l.event_name LIKE ? ESCAPE '\\')")
      parameters.push(pattern, pattern, pattern)
    }
    if (query.cursor !== undefined) {
      const cursor = decodeLogCursor(query.cursor)
      conditions.push('(l.time_us < ? OR (l.time_us = ? AND l.id < ?))')
      parameters.push(cursor.timeUs, cursor.timeUs, cursor.id)
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`
    const rows = z.array(logRowSchema).parse(
      prepare(
        `SELECT l.id, l.time_us, l.severity_number, l.severity_text, l.body, l.service, l.scope, l.trace_id, l.span_id, l.event_name, l.attributes,
             r.attributes AS resource
           FROM logs l LEFT JOIN resources r ON r.id = l.resource_id ${where} ORDER BY l.time_us DESC, l.id DESC LIMIT ?`,
      ).all(...parameters, limit + 1),
    )
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      logs: page.map(row => ({
        id: row.id,
        timeMs: usToMs(row.time_us),
        severityNumber: row.severity_number,
        severityText: row.severity_text,
        body: row.body,
        service: row.service,
        scope: row.scope,
        traceId: row.trace_id,
        spanId: row.span_id,
        eventName: row.event_name,
        attributes: attributesJsonSchema.parse(JSON.parse(row.attributes)),
        resource: row.resource === null ? {} : attributesJsonSchema.parse(JSON.parse(row.resource)),
      })),
      nextCursor: rows.length > limit && last !== undefined ? `${String(last.time_us)}:${String(last.id)}` : null,
    }
  }

  const metricPointCount = (): number => countSchema.parse(prepare('SELECT COUNT(*) AS count FROM metric_points').get()).count

  const ingestMetrics = (points: readonly NormalizedMetricPoint[], retention: Retention): number => {
    if (points.length === 0) return 0
    const receivedMs = now()
    transaction(() => {
      for (const point of points)
        prepare(
          `INSERT INTO metric_points (name, service, type, unit, description, monotonic, temporality, attributes, time_us, value, count, sum, received_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          point.name,
          point.service,
          point.type,
          point.unit,
          point.description,
          point.monotonic ? 1 : 0,
          point.temporality,
          JSON.stringify(point.attributes),
          point.timeUs,
          point.value,
          point.count,
          point.sum,
          receivedMs,
        )
    })
    prune(retention)
    return points.length
  }

  const listMetrics = (query: {
    readonly windowMinutes: number
    readonly service?: string | undefined
    readonly search?: string | undefined
  }): MetricSummary[] => {
    const sinceUs = (now() - query.windowMinutes * 60_000) * 1000
    const conditions = ['m.time_us >= ?']
    const parameters: SQLInputValue[] = [sinceUs]
    if (query.service !== undefined) {
      conditions.push('m.service = ?')
      parameters.push(query.service)
    }
    if (query.search !== undefined) {
      conditions.push("(m.name LIKE ? ESCAPE '\\' OR m.description LIKE ? ESCAPE '\\')")
      parameters.push(`%${escapeLike(query.search)}%`, `%${escapeLike(query.search)}%`)
    }
    return z
      .array(
        z.object({
          service: z.string(),
          name: z.string(),
          type: metricTypeSchema,
          unit: z.string().nullable(),
          description: z.string().nullable(),
          points: z.number(),
          series: z.number(),
          last_us: z.number(),
          last_value: z.number().nullable(),
        }),
      )
      .parse(
        prepare(
          `SELECT m.service, m.name, MAX(m.type) AS type, MAX(m.unit) AS unit, MAX(m.description) AS description, COUNT(*) AS points,
             COUNT(DISTINCT m.attributes) AS series, MAX(m.time_us) AS last_us,
             (SELECT l.value FROM metric_points l WHERE l.service = m.service AND l.name = m.name ORDER BY l.time_us DESC, l.id DESC LIMIT 1) AS last_value
           FROM metric_points m WHERE ${conditions.join(' AND ')} GROUP BY m.service, m.name ORDER BY m.service, m.name LIMIT 500`,
        ).all(...parameters),
      )
      .map(row => ({
        service: row.service,
        name: row.name,
        type: row.type,
        unit: row.unit,
        description: row.description,
        points: row.points,
        series: row.series,
        lastMs: usToMs(row.last_us),
        lastValue: row.series === 1 ? row.last_value : null,
      }))
  }

  /**
   * One metric's series over a window, at most 20 series of 500 points. A cumulative monotonic sum (a counter) becomes
   * its increase between points, since its raw value only ever climbs; a reset (the value drops) starts again from it.
   */
  const metricSeries = (query: { readonly name: string; readonly service: string; readonly windowMinutes: number }): MetricSeries => {
    const sinceUs = (now() - query.windowMinutes * 60_000) * 1000
    const rows = z
      .array(
        z.object({
          type: metricTypeSchema,
          unit: z.string().nullable(),
          description: z.string().nullable(),
          monotonic: z.number(),
          temporality: z.string(),
          attributes: z.string(),
          time_us: z.number(),
          value: z.number().nullable(),
        }),
      )
      .parse(
        prepare(
          `SELECT type, unit, description, monotonic, temporality, attributes, time_us, value FROM metric_points
           WHERE service = ? AND name = ? AND time_us >= ? ORDER BY attributes, time_us`,
        ).all(query.service, query.name, sinceUs),
      )
    const first = rows[0]
    if (first === undefined) throw new TraceStoreError('not-found', `No points for metric ${query.name} of ${query.service} in this window.`)
    const counter = first.type === 'sum' && first.monotonic === 1 && first.temporality === 'cumulative'
    const valueKind = counter ? 'increase' : first.type === 'gauge' || first.type === 'sum' ? 'value' : 'mean'
    const grouped = [...LatencyStats.groupBy(rows, row => row.attributes).entries()]
    return {
      service: query.service,
      name: query.name,
      type: first.type,
      unit: first.unit,
      description: first.description,
      valueKind,
      truncatedSeries: Math.max(0, grouped.length - MAX_METRIC_SERIES),
      series: grouped.slice(0, MAX_METRIC_SERIES).map(([attributes, points]) => {
        const values = points.flatMap(point => (point.value === null ? [] : [{ timeMs: usToMs(point.time_us), value: point.value }]))
        const charted = counter
          ? values.slice(1).map((point, index) => {
              const previous = values[index]?.value ?? 0
              return { timeMs: point.timeMs, value: point.value >= previous ? point.value - previous : point.value }
            })
          : values
        return { attributes: attributesJsonSchema.parse(JSON.parse(attributes)), points: charted.slice(-MAX_SERIES_POINTS) }
      }),
    }
  }

  const logCount = (): number => countSchema.parse(prepare('SELECT COUNT(*) AS count FROM logs').get()).count

  const ingest = (spans: readonly NormalizedSpan[], retention: Retention): IngestResult => {
    if (spans.length === 0) return { stored: 0, prunedTraces: 0 }
    const receivedMs = now()
    transaction(() => {
      const touched = new Set<string>()
      for (const span of spans) {
        const resourceId = storeResource(span.resource)
        prepare(
          `INSERT OR REPLACE INTO spans (trace_id, span_id, parent_span_id, name, service, scope, kind, start_us, end_us, status_code, status_message,
             error_type, session_id, attributes, resource_id, events, link_count, received_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          span.traceId,
          span.spanId,
          span.parentSpanId,
          span.name,
          span.service,
          span.scope,
          span.kind,
          span.startUs,
          span.endUs,
          span.statusCode,
          span.statusMessage,
          errorTypeOf(span),
          span.sessionId,
          JSON.stringify(span.attributes),
          resourceId,
          JSON.stringify(span.events),
          span.linkCount,
          receivedMs,
        )
        touched.add(span.traceId)
      }
      for (const traceId of touched) refreshTrace(traceId, receivedMs)
    })
    return { stored: spans.length, prunedTraces: prune(retention) }
  }

  const list = (query: TraceListQuery): TraceList => {
    const limit = query.limit ?? 50
    const conditions: string[] = []
    const parameters: SQLInputValue[] = []
    if (query.service !== undefined) {
      conditions.push('EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND s.service = ?)')
      parameters.push(query.service)
    }
    if (query.operation !== undefined) {
      conditions.push('EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND s.name = ?)')
      parameters.push(query.operation)
    }
    if (query.status === 'error') conditions.push('t.error_count > 0')
    if (query.status === 'ok') conditions.push('t.error_count = 0')
    if (query.minDurationMs !== undefined) {
      conditions.push('(t.end_us - t.start_us) >= ?')
      parameters.push(Math.round(query.minDurationMs * 1000))
    }
    if (query.fromMs !== undefined) {
      conditions.push('t.start_us >= ?')
      parameters.push(Math.round(query.fromMs * 1000))
    }
    if (query.toMs !== undefined) {
      conditions.push('t.start_us < ?')
      parameters.push(Math.round(query.toMs * 1000))
    }
    if (query.sessionId !== undefined) {
      conditions.push('t.trace_id IN (SELECT trace_id FROM spans WHERE session_id = ?)')
      parameters.push(query.sessionId)
    }
    if (query.turn !== undefined) {
      conditions.push(
        `EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND ${SpanCost.attribute('dsh.turn')} = ?${query.sessionId === undefined ? '' : ' AND s.session_id = ?'})`,
      )
      parameters.push(query.turn, ...(query.sessionId === undefined ? [] : [query.sessionId]))
    }
    if (query.search !== undefined) {
      const pattern = `%${escapeLike(query.search)}%`
      conditions.push(
        `(t.trace_id = ? OR EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND (s.name LIKE ? ESCAPE '\\' OR s.attributes LIKE ? ESCAPE '\\' OR s.status_message LIKE ? ESCAPE '\\')))`,
      )
      parameters.push(query.search.toLowerCase(), pattern, pattern, pattern)
    }
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor)
      conditions.push('(t.start_us < ? OR (t.start_us = ? AND t.trace_id < ?))')
      parameters.push(cursor.startUs, cursor.startUs, cursor.traceId)
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`
    const rows = z.array(traceRowSchema).parse(
      prepare(
        `SELECT trace_id, root_name, root_service, start_us, end_us, span_count, error_count, services, session_id,
             (SELECT SUM(${SpanCost.modelCallCost}) FROM spans s WHERE s.trace_id = t.trace_id) AS cost_usd
           FROM traces t ${where}
           ORDER BY t.start_us DESC, t.trace_id DESC LIMIT ?`,
      ).all(...parameters, limit + 1),
    )
    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      traces: page.map(row => ({
        traceId: row.trace_id,
        rootName: row.root_name,
        rootService: row.root_service,
        startMs: usToMs(row.start_us),
        durationMs: usToMs(row.end_us - row.start_us),
        spanCount: row.span_count,
        errorCount: row.error_count,
        services: z.array(z.string()).parse(JSON.parse(row.services)),
        sessionId: row.session_id,
        costUsd: row.cost_usd,
      })),
      nextCursor: rows.length > limit && last !== undefined ? encodeCursor(last.start_us, last.trace_id) : null,
    }
  }

  const trace = (traceId: string): TraceDetail => {
    const rows = z.array(spanRowSchema).parse(
      prepare(
        `SELECT s.span_id, s.parent_span_id, s.name, s.service, s.scope, s.kind, s.start_us, s.end_us, s.status_code, s.status_message, s.session_id,
             s.attributes, r.attributes AS resource, s.events, s.link_count
           FROM spans s LEFT JOIN resources r ON r.id = s.resource_id WHERE s.trace_id = ?`,
      ).all(traceId.toLowerCase()),
    )
    if (rows.length === 0) throw new TraceStoreError('not-found', `No stored trace ${traceId}.`)
    const startUs = Math.min(...rows.map(row => row.start_us))
    const endUs = Math.max(...rows.map(row => row.end_us))
    const tree = buildSpanTree(rows.map(row => ({ ...row, spanId: row.span_id, parentSpanId: row.parent_span_id, startUs: row.start_us })))
    return {
      traceId: traceId.toLowerCase(),
      startMs: usToMs(startUs),
      durationMs: usToMs(endUs - startUs),
      spans: tree.map(entry => ({
        spanId: entry.span.span_id,
        parentSpanId: entry.span.parent_span_id,
        depth: entry.depth,
        childCount: entry.childCount,
        name: entry.span.name,
        service: entry.span.service,
        scope: entry.span.scope,
        kind: KINDS[entry.span.kind] ?? 'unspecified',
        offsetMs: usToMs(entry.span.start_us - startUs),
        durationMs: usToMs(entry.span.end_us - entry.span.start_us),
        status: STATUSES[entry.span.status_code] ?? 'unset',
        statusMessage: entry.span.status_message,
        sessionId: entry.span.session_id,
        attributes: attributesJsonSchema.parse(JSON.parse(entry.span.attributes)),
        resource: entry.span.resource === null ? {} : attributesJsonSchema.parse(JSON.parse(entry.span.resource)),
        events: eventsJsonSchema.parse(JSON.parse(entry.span.events)).map(event => ({
          name: event.name,
          offsetMs: usToMs(event.timeUs - startUs),
          attributes: event.attributes,
        })),
        linkCount: entry.span.link_count,
      })),
    }
  }

  /** Model calls per service and model over a window: calls, gen_ai.usage token sums and the dshx.cost.usd sum. */
  const modelUsageOf = (query: { readonly sinceUs: number; readonly service?: string | undefined }): ModelUsage[] => {
    const attribute = SpanCost.attribute
    const rows = z
      .array(
        z.object({
          service: z.string(),
          provider: z.string().nullable(),
          model: z.string(),
          calls: z.number(),
          input_tokens: z.number().nullable(),
          output_tokens: z.number().nullable(),
          cost_usd: z.number().nullable(),
        }),
      )
      .parse(
        prepare(
          `SELECT s.service, ${attribute('gen_ai.provider.name')} AS provider, COALESCE(${attribute('gen_ai.request.model')}, s.name) AS model,
             COUNT(*) AS calls, SUM(${attribute('gen_ai.usage.input_tokens')}) AS input_tokens,
             SUM(${attribute('gen_ai.usage.output_tokens')}) AS output_tokens, SUM(${attribute(SpanCost.attributeKey)}) AS cost_usd
           FROM spans s WHERE s.start_us >= ? AND ${SpanCost.isModelCall}${query.service === undefined ? '' : ' AND s.service = ?'}
           GROUP BY 1, 2, 3 ORDER BY cost_usd IS NULL, cost_usd DESC, calls DESC LIMIT 50`,
        ).all(query.sinceUs, ...(query.service === undefined ? [] : [query.service])),
      )
    return rows.map(row => ({
      service: row.service,
      provider: row.provider,
      model: row.model,
      calls: row.calls,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      costUsd: row.cost_usd,
    }))
  }

  const statsOf = (query: { readonly windowMinutes: number; readonly service?: string | undefined; readonly limit: number }): TraceStats => {
    const sinceUs = (now() - query.windowMinutes * 60_000) * 1000
    const samples = z
      .array(z.object({ service: z.string(), name: z.string(), duration_us: z.number(), status_code: z.number() }))
      .parse(
        query.service === undefined
          ? prepare('SELECT service, name, end_us - start_us AS duration_us, status_code FROM spans WHERE start_us >= ?').all(sinceUs)
          : prepare('SELECT service, name, end_us - start_us AS duration_us, status_code FROM spans WHERE start_us >= ? AND service = ?').all(
              sinceUs,
              query.service,
            ),
      )
      .map(row => ({ service: row.service, name: row.name, durationMs: usToMs(row.duration_us), error: row.status_code === 2 }))
    const byCount = <Entry extends { readonly count: number }>(left: Entry, right: Entry): number => right.count - left.count
    return {
      windowMinutes: query.windowMinutes,
      spans: samples.length,
      models: modelUsageOf({ sinceUs, service: query.service }),
      services: [...LatencyStats.groupBy(samples, sample => sample.service)]
        .map(([service, group]) => ({ service, ...LatencyStats.summarize(group) }))
        .sort(byCount),
      operations: [...LatencyStats.groupBy(samples, sample => `${sample.service}\u0000${sample.name}`).values()]
        .map(group => ({ service: group[0]?.service ?? '', name: group[0]?.name ?? '', ...LatencyStats.summarize(group) }))
        .sort(byCount)
        .slice(0, query.limit),
    }
  }

  const errorGroups = (query: { readonly windowMinutes: number; readonly limit: number }): ErrorGroup[] => {
    const sinceUs = (now() - query.windowMinutes * 60_000) * 1000
    const rows = z
      .array(
        z.object({
          service: z.string(),
          name: z.string(),
          error_type: z.string().nullable(),
          status_message: z.string().nullable(),
          start_us: z.number(),
          trace_id: z.string(),
          span_id: z.string(),
        }),
      )
      .parse(
        prepare(
          'SELECT service, name, error_type, status_message, start_us, trace_id, span_id FROM spans WHERE status_code = 2 AND start_us >= ? ORDER BY start_us DESC',
        ).all(sinceUs),
      )
    return [...LatencyStats.groupBy(rows, row => [row.service, row.name, row.error_type ?? '', messageShape(row.status_message) ?? ''].join('\u0000')).values()]
      .flatMap(group => {
        const newest = group[0]
        const oldest = group.at(-1)
        if (newest === undefined || oldest === undefined) return []
        return [
          {
            service: newest.service,
            name: newest.name,
            errorType: newest.error_type,
            message: newest.status_message,
            count: group.length,
            firstSeenMs: usToMs(oldest.start_us),
            lastSeenMs: usToMs(newest.start_us),
            sampleTraceId: newest.trace_id,
            sampleSpanId: newest.span_id,
          },
        ]
      })
      .sort((left, right) => right.count - left.count || right.lastSeenMs - left.lastSeenMs)
      .slice(0, query.limit)
  }

  /** Calls between services: a span whose parent belongs to another service is one call from the parent's service. */
  const serviceMap = (query: { readonly windowMinutes: number }): ServiceMap => {
    const sinceUs = (now() - query.windowMinutes * 60_000) * 1000
    const calls = z
      .array(z.object({ source: z.string(), target: z.string(), duration_us: z.number(), status_code: z.number() }))
      .parse(
        prepare(
          `SELECT p.service AS source, c.service AS target, c.end_us - c.start_us AS duration_us, c.status_code
           FROM spans c JOIN spans p ON p.trace_id = c.trace_id AND p.span_id = c.parent_span_id
           WHERE c.start_us >= ? AND p.service <> c.service`,
        ).all(sinceUs),
      )
      .map(row => ({ source: row.source, target: row.target, durationMs: usToMs(row.duration_us), error: row.status_code === 2 }))
    const stats = statsOf({ windowMinutes: query.windowMinutes, limit: 1 })
    return {
      windowMinutes: query.windowMinutes,
      nodes: stats.services,
      edges: [...LatencyStats.groupBy(calls, call => `${call.source}\u0000${call.target}`).values()]
        .map(group => ({ source: group[0]?.source ?? '', target: group[0]?.target ?? '', ...LatencyStats.summarize(group) }))
        .sort((left, right) => right.count - left.count),
    }
  }

  /**
   * Everything one DSH Session sent: every span of the traces that carry its `dsh.session.id` anywhere (so plugin spans
   * nested under a turn count), classified by the GenAI `gen_ai.operation.name` (span-name prefix as a fallback).
   * Token totals come from model-call spans only: the turn span repeats them as its own totals.
   */
  const sessionSummary = (sessionId: string): SessionSummary => {
    const attribute = (key: string): string => `json_extract(s.attributes, '$."${key}"')`
    const rows = z
      .array(
        z.object({
          trace_id: z.string(),
          name: z.string(),
          service: z.string(),
          start_us: z.number(),
          end_us: z.number(),
          status_code: z.number(),
          operation: z.string().nullable(),
          input_tokens: z.number().nullable(),
          output_tokens: z.number().nullable(),
          cache_read_tokens: z.number().nullable(),
          reasoning_tokens: z.number().nullable(),
          cost_usd: z.number().nullable(),
          turn: z.number().nullable(),
          span_session_id: z.string().nullable(),
        }),
      )
      .parse(
        prepare(
          `SELECT s.trace_id, s.name, s.service, s.start_us, s.end_us, s.status_code, s.session_id AS span_session_id,
             ${SpanCost.modelCallCost} AS cost_usd,
             ${attribute('dsh.turn')} AS turn,
             ${attribute('gen_ai.operation.name')} AS operation,
             ${attribute('gen_ai.usage.input_tokens')} AS input_tokens,
             ${attribute('gen_ai.usage.output_tokens')} AS output_tokens,
             COALESCE(${attribute('gen_ai.usage.cache_read.input_tokens')}, ${attribute('gen_ai.usage.cache_read_input_tokens')}) AS cache_read_tokens,
             ${attribute('gen_ai.usage.reasoning_tokens')} AS reasoning_tokens
           FROM spans s WHERE s.trace_id IN (SELECT trace_id FROM spans WHERE session_id = ?)`,
        ).all(sessionId),
      )
    const operationOf = (row: (typeof rows)[number]): 'turn' | 'model' | 'tool' | 'other' => {
      if (row.operation === 'invoke_agent') return 'turn'
      if (row.operation === 'chat' || row.operation === 'text_completion' || row.operation === 'generate_content') return 'model'
      if (row.operation === 'execute_tool') return 'tool'
      if (row.operation !== null) return 'other'
      if (row.name.startsWith('chat ')) return 'model'
      if (row.name.startsWith('execute_tool ')) return 'tool'
      return row.name.startsWith('invoke_agent') ? 'turn' : 'other'
    }
    const classified = rows.map(row => ({ ...row, kind: operationOf(row) }))
    const modelCalls = classified.filter(row => row.kind === 'model')
    const earliest = (group: readonly (typeof rows)[number][]): number => group.reduce((least, row) => Math.min(least, row.start_us), Number.POSITIVE_INFINITY)
    const latest = (group: readonly (typeof rows)[number][]): number => group.reduce((most, row) => Math.max(most, row.end_us), 0)
    const traces = [...LatencyStats.groupBy(rows, row => row.trace_id).values()].map(group => ({
      durationMs: usToMs(latest(group) - earliest(group)),
      error: group.some(row => row.status_code === 2),
    }))
    const withUsage = modelCalls.filter(row => row.input_tokens !== null || row.output_tokens !== null)
    const sum = (values: readonly (number | null)[]): number => values.reduce<number>((total, value) => total + (value ?? 0), 0)
    const priced = modelCalls.filter(row => row.cost_usd !== null)
    // A subagent's calls share its parent's trace but carry their own Session and turn numbers.
    const ownPriced = priced.filter(row => row.span_session_id === sessionId)
    return {
      sessionId,
      traces: traces.length,
      spans: rows.length,
      errorSpans: rows.filter(row => row.status_code === 2).length,
      turns: classified.filter(row => row.kind === 'turn').length,
      modelCalls: modelCalls.length,
      toolCalls: classified.filter(row => row.kind === 'tool').length,
      firstMs: rows.length === 0 ? null : usToMs(earliest(rows)),
      lastMs: rows.length === 0 ? null : usToMs(latest(rows)),
      totalTraceMs: traces.reduce((total, trace) => total + trace.durationMs, 0),
      traceLatency: LatencyStats.summarize(traces),
      modelLatency: LatencyStats.summarize(modelCalls.map(row => ({ durationMs: usToMs(row.end_us - row.start_us), error: row.status_code === 2 }))),
      tokens:
        withUsage.length === 0
          ? null
          : {
              input: sum(withUsage.map(row => row.input_tokens)),
              output: sum(withUsage.map(row => row.output_tokens)),
              cacheRead: sum(withUsage.map(row => row.cache_read_tokens)),
              reasoning: sum(withUsage.map(row => row.reasoning_tokens)),
            },
      costUsd: priced.length === 0 ? null : sum(priced.map(row => row.cost_usd)),
      turnCosts: [
        ...LatencyStats.groupBy(
          ownPriced.filter(row => row.turn !== null),
          row => String(row.turn),
        ).values(),
      ]
        .map(group => ({ turn: group[0]?.turn ?? 0, costUsd: sum(group.map(row => row.cost_usd)), modelCalls: group.length }))
        .sort((left, right) => left.turn - right.turn)
        .slice(-500),
      services: [...new Set(rows.map(row => row.service))].sort(),
    }
  }

  const spanSamples = (query: SpanSampleQuery): { readonly samples: SpanSample[]; readonly truncated: boolean } => {
    const sinceUs = Math.round(query.endedAfterMs * 1000)
    const conditions = ['s.start_us >= ?', 's.end_us >= ?']
    const parameters: SQLInputValue[] = [sinceUs - SAMPLE_LOOKBACK_US, sinceUs]
    if (query.service !== null) {
      conditions.push('s.service = ?')
      parameters.push(query.service)
    }
    if (query.operation !== null) {
      const prefix = query.operation.endsWith('*') ? query.operation.slice(0, -1) : null
      conditions.push(prefix === null ? 's.name = ?' : "s.name LIKE ? ESCAPE '\\'")
      parameters.push(prefix === null ? query.operation : `${escapeLike(prefix)}%`)
    }
    if (query.attribute !== null) {
      conditions.push(query.attribute.value === '*' ? 'json_extract(s.attributes, ?) IS NOT NULL' : 'CAST(json_extract(s.attributes, ?) AS TEXT) = ?')
      parameters.push(`$."${query.attribute.key}"`)
      if (query.attribute.value !== '*') parameters.push(query.attribute.value)
    }
    const group = query.groupAttribute === undefined ? 'NULL' : 'CAST(json_extract(s.attributes, ?) AS TEXT)'
    const measure = query.measureAttribute === undefined ? 'NULL' : 'json_extract(s.attributes, ?)'
    const selectParameters = [
      ...(query.groupAttribute === undefined ? [] : [`$."${query.groupAttribute}"`]),
      ...(query.measureAttribute === undefined ? [] : [`$."${query.measureAttribute}"`]),
    ]
    const rows = z
      .array(
        z.object({
          trace_id: z.string(),
          name: z.string(),
          service: z.string(),
          duration_us: z.number(),
          status_code: z.number(),
          session_id: z.string().nullable(),
          group_value: z.string().nullable(),
          measure_value: z.unknown(),
        }),
      )
      .parse(
        prepare(
          `SELECT s.trace_id, s.name, s.service, s.end_us - s.start_us AS duration_us, s.status_code, COALESCE(s.session_id, t.session_id) AS session_id,
             ${group} AS group_value, ${measure} AS measure_value
           FROM spans s LEFT JOIN traces t ON t.trace_id = s.trace_id WHERE ${conditions.join(' AND ')} ORDER BY s.end_us DESC LIMIT ?`,
        ).all(...selectParameters, ...parameters, query.limit + 1),
      )
    return {
      truncated: rows.length > query.limit,
      samples: rows.slice(0, query.limit).map(row => ({
        traceId: row.trace_id,
        name: row.name,
        service: row.service,
        durationMs: usToMs(row.duration_us),
        error: row.status_code === 2,
        sessionId: row.session_id,
        group: row.group_value,
        measure: typeof row.measure_value === 'number' ? row.measure_value : null,
      })),
    }
  }

  const summary = (): StoreSummary => {
    const row = z
      .object({ traces: z.number(), oldest: z.number().nullable(), newest: z.number().nullable() })
      .parse(prepare('SELECT COUNT(*) AS traces, MIN(start_us) AS oldest, MAX(start_us) AS newest FROM traces').get())
    return {
      spans: spanCount(),
      traces: row.traces,
      logs: logCount(),
      metricPoints: metricPointCount(),
      oldestMs: row.oldest === null ? null : usToMs(row.oldest),
      newestMs: row.newest === null ? null : usToMs(row.newest),
    }
  }

  const clear = (): ClearResult =>
    transaction(() => {
      const before = summary()
      database.exec('DELETE FROM spans; DELETE FROM traces; DELETE FROM logs; DELETE FROM metric_points; DELETE FROM resources;')
      return { removedSpans: before.spans, removedTraces: before.traces, removedLogs: before.logs, removedMetricPoints: before.metricPoints }
    })

  return {
    ingest,
    ingestLogs,
    ingestMetrics,
    listMetrics,
    metricSeries,
    searchLogs,
    prune,
    list,
    trace,
    stats: statsOf,
    errorGroups,
    serviceMap,
    sessionSummary,
    spanSamples,
    summary,
    clear,
    close: () => database.close(),
  }
}
