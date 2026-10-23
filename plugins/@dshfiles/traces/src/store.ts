import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { z } from 'zod'
import type { NormalizedLog, NormalizedSpan } from './otlp/normalize.js'
import { buildSpanTree } from './span-tree.js'
import { LatencyStats } from './stats.js'
import {
  attributeValueSchema,
  type ErrorGroup,
  type LogList,
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
]

export type Retention = { readonly maxAgeHours: number; readonly maxSpans: number; readonly maxLogs: number }

export type TraceListQuery = {
  readonly service?: string | undefined
  readonly operation?: string | undefined
  readonly status?: 'all' | 'error' | 'ok' | undefined
  readonly minDurationMs?: number | undefined
  readonly fromMs?: number | undefined
  readonly toMs?: number | undefined
  readonly search?: string | undefined
  readonly sessionId?: string | undefined
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
}

type IngestResult = { readonly stored: number; readonly prunedTraces: number }
type StoreSummary = {
  readonly spans: number
  readonly traces: number
  readonly logs: number
  readonly oldestMs: number | null
  readonly newestMs: number | null
}
type ClearResult = { readonly removedSpans: number; readonly removedTraces: number; readonly removedLogs: number }

export type LogSearchQuery = {
  readonly service?: string | undefined
  readonly minSeverity?: number | undefined
  readonly search?: string | undefined
  readonly attribute?: { readonly key: string; readonly value: string } | undefined
  readonly traceId?: string | undefined
  readonly spanId?: string | undefined
  readonly fromMs?: number | undefined
  readonly toMs?: number | undefined
  readonly cursor?: string | undefined
  readonly limit?: number | undefined
}

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
      conditions.push('t.session_id = ?')
      parameters.push(query.sessionId)
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
        `SELECT trace_id, root_name, root_service, start_us, end_us, span_count, error_count, services, session_id FROM traces t ${where}
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

  const stats = (query: { readonly windowMinutes: number; readonly service?: string | undefined; readonly limit: number }): TraceStats => {
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

  const summary = (): StoreSummary => {
    const row = z
      .object({ traces: z.number(), oldest: z.number().nullable(), newest: z.number().nullable() })
      .parse(prepare('SELECT COUNT(*) AS traces, MIN(start_us) AS oldest, MAX(start_us) AS newest FROM traces').get())
    return {
      spans: spanCount(),
      traces: row.traces,
      logs: logCount(),
      oldestMs: row.oldest === null ? null : usToMs(row.oldest),
      newestMs: row.newest === null ? null : usToMs(row.newest),
    }
  }

  const clear = (): ClearResult =>
    transaction(() => {
      const before = summary()
      database.exec('DELETE FROM spans; DELETE FROM traces; DELETE FROM logs; DELETE FROM resources;')
      return { removedSpans: before.spans, removedTraces: before.traces, removedLogs: before.logs }
    })

  return {
    ingest,
    ingestLogs,
    searchLogs,
    prune,
    list,
    trace,
    stats,
    errorGroups,
    summary,
    clear,
    close: () => database.close(),
  }
}
