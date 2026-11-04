import { createHash } from 'node:crypto'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { Clock, Context, Effect, Layer, Ref, Schema } from 'effect'
import { SqlClient, SqlSchema, type Statement } from 'effect/sql'
import { orDieOnStorage } from './storage-failure.js'
import type { NormalizedLog, NormalizedMetricPoint, NormalizedSpan } from './otlp/normalize.js'
import { SpanCost } from './span-cost.js'
import { buildSpanTree } from './span-tree.js'
import { LatencyStats } from './stats.js'
import {
  attributeValueSchema,
  type AttributeValue,
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

const scriptOf = (script: string) =>
  Effect.flatMap(SqlClient.SqlClient, sql =>
    Effect.forEach(
      script
        .split(';')
        .map(statement => statement.trim())
        .filter(statement => statement.length > 0),
      statement => sql.unsafe(statement),
      { discard: true },
    ),
  )

const traceMigrations = {
  '1_spans': scriptOf(`
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
  `),
  '2_logs': scriptOf(`
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
  `),
  '3_metric_points': scriptOf(`
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
  `),
  // A subagent's turns join their parent's trace, so a thread's traces are those where any span carries its Session.
  '4_spans_session': scriptOf(`
  CREATE INDEX spans_session ON spans (session_id, trace_id);
  `),
  '5_retention_indexes': scriptOf(`
  CREATE INDEX traces_retention_order ON traces (received_ms, start_us);
  CREATE INDEX spans_resource ON spans (resource_id);
  CREATE INDEX logs_resource ON logs (resource_id);
  `),
  // Alert rules sample the spans that ended in their window, newest first, every minute; by start time alone each read
  // walked the whole six-hour lookback (135–236 ms of blocking SQLite per rule on a 100k-span store).
  '6_spans_end': scriptOf(`
  CREATE INDEX spans_end ON spans (end_us);
  `),
}

/** The span store's SQLite file; its statements never open spans, so storing traces never traces itself. */
export class TraceDb extends Context.Service<TraceDb, SqlClient.SqlClient>()('@dshfiles/traces/TraceDb') {
  static readonly layerAt = (filename: string) => SqliteStore.layerAs(TraceDb, { filename, migrations: traceMigrations, legacyUserVersion: 5 })
}

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

export type SpanSamples = { readonly samples: readonly SpanSample[]; readonly truncated: boolean }

type StoreSummary = {
  readonly spans: number
  readonly traces: number
  readonly logs: number
  readonly metricPoints: number
  readonly oldestMs: number | null
  readonly newestMs: number | null
}
type ClearResult = { readonly removedSpans: number; readonly removedTraces: number; readonly removedLogs: number; readonly removedMetricPoints: number }

export class InvalidCursor extends Schema.TaggedError<InvalidCursor>()(
  'InvalidCursor',
  { list: Schema.Literals(['traces', 'logs']) },
  { dshxWireCode: 'invalid-cursor' },
) {
  override get message(): string {
    return `The ${this.list} cursor is invalid.`
  }
}

export class TraceNotFound extends Schema.TaggedError<TraceNotFound>()('TraceNotFound', { traceId: Schema.String }, { dshxWireCode: 'not-found' }) {
  override get message(): string {
    return `No stored trace ${this.traceId}.`
  }
}

export class MetricNotFound extends Schema.TaggedError<MetricNotFound>()(
  'MetricNotFound',
  { name: Schema.String, service: Schema.String },
  { dshxWireCode: 'not-found' },
) {
  override get message(): string {
    return `No points for metric ${this.name} of ${this.service} in this window.`
  }
}

const MAX_METRIC_SERIES = 20
const MAX_SERIES_POINTS = 500
const PRUNE_TRACE_BATCH_SIZE = 128
/** 18 span columns × 500 rows stays well under SQLite's 32,766 bound parameters per statement. */
const MAX_ROWS_PER_STATEMENT = 500

const chunksOf = <Item>(items: readonly Item[], size: number): Item[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))
/** Spans longer than this are not looked for: it bounds the start-time index scan of an end-time window. */
const SAMPLE_LOOKBACK_US = 6 * 3_600_000_000

const KINDS: readonly SpanKind[] = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer']
const STATUSES: readonly SpanStatus[] = ['unset', 'ok', 'error']

const finiteNumber = Schema.Number.check(Schema.isFinite())
const attributesJson = Schema.fromJsonString(Schema.Record(Schema.String, attributeValueSchema))
const nullableAttributesJson = Schema.NullOr(attributesJson)
const eventsJson = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ name: Schema.String, timeUs: finiteNumber, attributes: Schema.Record(Schema.String, attributeValueSchema) })),
)
const metricTypeSchema = Schema.Literals(['gauge', 'sum', 'histogram', 'exponentialHistogram', 'summary'])

const traceRow = Schema.Struct({
  trace_id: Schema.String,
  root_name: Schema.String,
  root_service: Schema.String,
  start_us: finiteNumber,
  end_us: finiteNumber,
  span_count: finiteNumber,
  error_count: finiteNumber,
  services: Schema.fromJsonString(Schema.Array(Schema.String)),
  session_id: Schema.NullOr(Schema.String),
  cost_usd: Schema.NullOr(finiteNumber),
})
const spanRow = Schema.Struct({
  span_id: Schema.String,
  parent_span_id: Schema.NullOr(Schema.String),
  name: Schema.String,
  service: Schema.String,
  scope: Schema.NullOr(Schema.String),
  kind: finiteNumber,
  start_us: finiteNumber,
  end_us: finiteNumber,
  status_code: finiteNumber,
  status_message: Schema.NullOr(Schema.String),
  session_id: Schema.NullOr(Schema.String),
  attributes: attributesJson,
  resource: nullableAttributesJson,
  events: eventsJson,
  link_count: finiteNumber,
})
const countRow = Schema.Struct({ count: finiteNumber })
const oldestTraceRow = Schema.Struct({ trace_id: Schema.String, span_count: finiteNumber, received_ms: finiteNumber, start_us: finiteNumber })
const logRow = Schema.Struct({
  id: finiteNumber,
  time_us: finiteNumber,
  severity_number: finiteNumber,
  severity_text: Schema.NullOr(Schema.String),
  body: Schema.String,
  service: Schema.String,
  scope: Schema.NullOr(Schema.String),
  trace_id: Schema.NullOr(Schema.String),
  span_id: Schema.NullOr(Schema.String),
  event_name: Schema.NullOr(Schema.String),
  attributes: attributesJson,
  resource: nullableAttributesJson,
})
const traceIdRow = Schema.Struct({ trace_id: Schema.String })
const changesRow = Schema.Struct({ changes: finiteNumber })
const metricListRow = Schema.Struct({
  service: Schema.String,
  name: Schema.String,
  type: metricTypeSchema,
  unit: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  points: finiteNumber,
  series: finiteNumber,
  last_us: finiteNumber,
  last_value: Schema.NullOr(finiteNumber),
})
const metricPointRow = Schema.Struct({
  type: metricTypeSchema,
  unit: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  monotonic: finiteNumber,
  temporality: Schema.String,
  attributes: Schema.String,
  time_us: finiteNumber,
  value: Schema.NullOr(finiteNumber),
})
const modelUsageRow = Schema.Struct({
  service: Schema.String,
  provider: Schema.NullOr(Schema.String),
  model: Schema.String,
  calls: finiteNumber,
  input_tokens: Schema.NullOr(finiteNumber),
  output_tokens: Schema.NullOr(finiteNumber),
  cost_usd: Schema.NullOr(finiteNumber),
})
const spanStatRow = Schema.Struct({ service: Schema.String, name: Schema.String, duration_us: finiteNumber, status_code: finiteNumber })
const errorSpanRow = Schema.Struct({
  service: Schema.String,
  name: Schema.String,
  error_type: Schema.NullOr(Schema.String),
  status_message: Schema.NullOr(Schema.String),
  start_us: finiteNumber,
  trace_id: Schema.String,
  span_id: Schema.String,
})
const serviceCallRow = Schema.Struct({ source: Schema.String, target: Schema.String, duration_us: finiteNumber, status_code: finiteNumber })
const sessionSpanRow = Schema.Struct({
  trace_id: Schema.String,
  name: Schema.String,
  service: Schema.String,
  start_us: finiteNumber,
  end_us: finiteNumber,
  status_code: finiteNumber,
  operation: Schema.NullOr(Schema.String),
  input_tokens: Schema.NullOr(finiteNumber),
  output_tokens: Schema.NullOr(finiteNumber),
  cache_read_tokens: Schema.NullOr(finiteNumber),
  reasoning_tokens: Schema.NullOr(finiteNumber),
  cost_usd: Schema.NullOr(finiteNumber),
  turn: Schema.NullOr(finiteNumber),
  span_session_id: Schema.NullOr(Schema.String),
})
type SessionSpanRow = Schema.Schema.Type<typeof sessionSpanRow>
const spanSampleRow = Schema.Struct({
  trace_id: Schema.String,
  name: Schema.String,
  service: Schema.String,
  duration_us: finiteNumber,
  status_code: finiteNumber,
  session_id: Schema.NullOr(Schema.String),
  group_value: Schema.NullOr(Schema.String),
  measure_value: Schema.Unknown,
})
const storeSummaryRow = Schema.Struct({ traces: finiteNumber, oldest: Schema.NullOr(finiteNumber), newest: Schema.NullOr(finiteNumber) })

const traceCursor = /^(\d{1,17}):([0-9a-f]{32})$/
const logCursor = /^(\d{1,17}):(\d{1,15})$/

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

const operationOf = (row: SessionSpanRow): 'turn' | 'model' | 'tool' | 'other' => {
  if (row.operation === 'invoke_agent') return 'turn'
  if (row.operation === 'chat' || row.operation === 'text_completion' || row.operation === 'generate_content') return 'model'
  if (row.operation === 'execute_tool') return 'tool'
  if (row.operation !== null) return 'other'
  if (row.name.startsWith('chat ')) return 'model'
  if (row.name.startsWith('execute_tool ')) return 'tool'
  return row.name.startsWith('invoke_agent') ? 'turn' : 'other'
}

const make = Effect.gen(function* () {
  const sql = yield* TraceDb
  const attribute = (key: string): Statement.Fragment => sql.literal(SpanCost.attribute(key))
  const modelCallCost = sql.literal(SpanCost.modelCallCost)
  const isModelCall = sql.literal(SpanCost.isModelCall)
  const whereOf = (conditions: readonly Statement.Fragment[]): Statement.Fragment =>
    conditions.length === 0 ? sql.literal('') : sql`WHERE ${sql.and(conditions)}`

  const count = (query: Statement.Statement<object>) => SqlSchema.findOne({ Request: Schema.Void, Result: countRow, execute: () => query })(undefined)
  const storedLogs = yield* Ref.make((yield* orDieOnStorage(count(sql`SELECT COUNT(*) AS count FROM logs`))).count)
  const storedMetricPoints = yield* Ref.make((yield* orDieOnStorage(count(sql`SELECT COUNT(*) AS count FROM metric_points`))).count)

  const changes = SqlSchema.findOne({ Request: Schema.Void, Result: changesRow, execute: () => sql`SELECT changes() AS changes` })
  const deleteCounted = Effect.fnUntraced(function* (statement: Statement.Statement<object>) {
    yield* statement
    return (yield* changes(undefined)).changes
  })

  /** One statement per chunk of traces: the root is the span with no stored parent, earliest first; services are the sorted distinct names. */
  const refreshTraces = (traceIds: readonly string[], receivedMs: number) =>
    Effect.forEach(
      chunksOf(traceIds, MAX_ROWS_PER_STATEMENT),
      chunk =>
        sql`INSERT OR REPLACE INTO traces (trace_id, root_name, root_service, start_us, end_us, span_count, error_count, services, session_id, received_ms)
          SELECT g.trace_id, r.name, r.service, g.start_us, g.end_us, g.span_count, g.error_count,
            (SELECT json_group_array(service) FROM (SELECT DISTINCT d.service FROM spans d WHERE d.trace_id = g.trace_id ORDER BY d.service)),
            g.session_id, ${receivedMs}
          FROM (
            SELECT trace_id, MIN(start_us) AS start_us, MAX(end_us) AS end_us, COUNT(*) AS span_count, SUM(status_code = 2) AS error_count,
              MAX(session_id) AS session_id,
              (SELECT s.span_id FROM spans s WHERE s.trace_id = a.trace_id
                ORDER BY (s.parent_span_id IS NULL OR NOT EXISTS (SELECT 1 FROM spans p WHERE p.trace_id = s.trace_id AND p.span_id = s.parent_span_id)) DESC, s.start_us
                LIMIT 1) AS root_span_id
            FROM spans a WHERE a.trace_id IN ${sql.in(chunk)} GROUP BY a.trace_id
          ) g JOIN spans r ON r.trace_id = g.trace_id AND r.span_id = g.root_span_id`,
      { discard: true },
    )

  const deleteTraces = (traceIds: readonly string[]) =>
    sql.withTransaction(
      Effect.forEach(
        traceIds,
        traceId => Effect.andThen(sql`DELETE FROM spans WHERE trace_id = ${traceId}`, sql`DELETE FROM traces WHERE trace_id = ${traceId}`),
        { discard: true },
      ),
    )

  const spanCountRow = SqlSchema.findOne({
    Request: Schema.Void,
    Result: countRow,
    execute: () => sql`SELECT COALESCE(SUM(span_count), 0) AS count FROM traces`,
  })
  const spanCount = Effect.map(spanCountRow(undefined), row => row.count)

  const expiredTraces = SqlSchema.findAll({
    Request: Schema.Number,
    Result: traceIdRow,
    execute: cutoff => sql`SELECT trace_id FROM traces WHERE received_ms < ${cutoff}`,
  })
  const oldestTraces = SqlSchema.findAll({
    Request: Schema.NullOr(Schema.Struct({ receivedMs: Schema.Number, startUs: Schema.Number, traceId: Schema.String })),
    Result: oldestTraceRow,
    execute: cursor =>
      cursor === null
        ? sql`SELECT trace_id, span_count, received_ms, start_us FROM traces ORDER BY received_ms, start_us, trace_id LIMIT ${PRUNE_TRACE_BATCH_SIZE}`
        : sql`SELECT trace_id, span_count, received_ms, start_us FROM traces WHERE (received_ms, start_us, trace_id) > (${cursor.receivedMs}, ${cursor.startUs}, ${cursor.traceId}) ORDER BY received_ms, start_us, trace_id LIMIT ${PRUNE_TRACE_BATCH_SIZE}`,
  })

  /** Retention drops whole traces, oldest received first, so a kept trace never loses part of its tree. */
  const pruneNow = Effect.fnUntraced(function* (retention: Retention) {
    const cutoff = (yield* Clock.currentTimeMillis) - retention.maxAgeHours * 3_600_000
    const expired = (yield* expiredTraces(cutoff)).map(row => row.trace_id)
    let removed = expired.length
    if (expired.length > 0) yield* deleteTraces(expired)
    let excess = (yield* spanCount) - retention.maxSpans
    if (excess > 0) {
      const victims: string[] = []
      let cursor: { readonly receivedMs: number; readonly startUs: number; readonly traceId: string } | null = null
      while (excess > 0) {
        const oldest: ReadonlyArray<Schema.Schema.Type<typeof oldestTraceRow>> = yield* oldestTraces(cursor)
        if (oldest.length === 0) break
        for (const trace of oldest) {
          victims.push(trace.trace_id)
          excess -= trace.span_count
          if (excess <= 0) break
        }
        const last = oldest.at(-1)
        if (last !== undefined) cursor = { receivedMs: last.received_ms, startUs: last.start_us, traceId: last.trace_id }
      }
      removed += victims.length
      if (victims.length > 0) yield* deleteTraces(victims)
    }
    const expiredLogs = yield* deleteCounted(sql`DELETE FROM logs WHERE received_ms < ${cutoff}`)
    const excessLogs = (yield* Ref.updateAndGet(storedLogs, stored => stored - expiredLogs)) - retention.maxLogs
    const droppedLogs = excessLogs > 0 ? yield* deleteCounted(sql`DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id LIMIT ${excessLogs})`) : 0
    yield* Ref.update(storedLogs, stored => stored - droppedLogs)
    const expiredMetricPoints = yield* deleteCounted(sql`DELETE FROM metric_points WHERE received_ms < ${cutoff}`)
    const excessPoints = (yield* Ref.updateAndGet(storedMetricPoints, stored => stored - expiredMetricPoints)) - retention.maxMetricPoints
    if (excessPoints > 0) {
      const droppedMetricPoints = yield* deleteCounted(
        sql`DELETE FROM metric_points WHERE id IN (SELECT id FROM metric_points ORDER BY id LIMIT ${excessPoints})`,
      )
      yield* Ref.update(storedMetricPoints, stored => stored - droppedMetricPoints)
    }
    if (removed > 0 || expiredLogs + droppedLogs > 0)
      yield* sql`DELETE FROM resources WHERE NOT EXISTS (SELECT 1 FROM spans WHERE spans.resource_id = resources.id) AND NOT EXISTS (SELECT 1 FROM logs WHERE logs.resource_id = resources.id)`
    return removed
  })

  /** Each distinct resource once, keyed by the SHA-1 of its JSON, so spans and logs share one row per process identity. */
  /** Multi-row inserts in bounded chunks: one statement per 500 rows instead of one per row on the hottest write path. */
  const insertRows = (into: string, rows: readonly Readonly<Record<string, string | number | null>>[]) =>
    Effect.forEach(
      chunksOf(rows, MAX_ROWS_PER_STATEMENT),
      ([first, ...rest]) => (first === undefined ? Effect.void : Effect.asVoid(sql`${sql.literal(into)} ${sql.insert([first, ...rest])}`)),
      { discard: true },
    )

  const storeResources = (resources: ReadonlyMap<string, string>) =>
    insertRows(
      'INSERT OR IGNORE INTO resources',
      [...resources].map(([attributes, id]) => ({ id, attributes })),
    )

  const resourceIdsOf = (resources: readonly Readonly<Record<string, AttributeValue>>[]) => {
    const ids = new Map<string, string>()
    const assigned = resources.map(resource => {
      const json = JSON.stringify(resource)
      const known = ids.get(json)
      if (known !== undefined) return known
      const id = createHash('sha1').update(json).digest('hex')
      ids.set(json, id)
      return id
    })
    return { ids, assigned }
  }

  const ingestSpans = Effect.fn('trace repo ingest spans')(function* (spans: readonly NormalizedSpan[], retention: Retention) {
    if (spans.length === 0) return { stored: 0, prunedTraces: 0 }
    const receivedMs = yield* Clock.currentTimeMillis
    const resources = resourceIdsOf(spans.map(span => span.resource))
    const rows = spans.map((span, index) => ({
      trace_id: span.traceId,
      span_id: span.spanId,
      parent_span_id: span.parentSpanId,
      name: span.name,
      service: span.service,
      scope: span.scope,
      kind: span.kind,
      start_us: span.startUs,
      end_us: span.endUs,
      status_code: span.statusCode,
      status_message: span.statusMessage,
      error_type: errorTypeOf(span),
      session_id: span.sessionId,
      attributes: JSON.stringify(span.attributes),
      resource_id: resources.assigned[index] ?? '',
      events: JSON.stringify(span.events),
      link_count: span.linkCount,
      received_ms: receivedMs,
    }))
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* storeResources(resources.ids)
        yield* insertRows('INSERT OR REPLACE INTO spans', rows)
        yield* refreshTraces([...new Set(spans.map(span => span.traceId))], receivedMs)
      }),
    )
    return { stored: spans.length, prunedTraces: yield* pruneNow(retention) }
  }, orDieOnStorage)

  const ingestLogs = Effect.fn('trace repo ingest logs')(function* (logs: readonly NormalizedLog[], retention: Retention) {
    if (logs.length === 0) return 0
    const receivedMs = yield* Clock.currentTimeMillis
    const resources = resourceIdsOf(logs.map(log => log.resource))
    const rows = logs.map((log, index) => ({
      time_us: log.timeUs,
      severity_number: log.severityNumber,
      severity_text: log.severityText,
      body: log.body,
      service: log.service,
      scope: log.scope,
      trace_id: log.traceId,
      span_id: log.spanId,
      event_name: log.eventName,
      attributes: JSON.stringify(log.attributes),
      resource_id: resources.assigned[index] ?? '',
      received_ms: receivedMs,
    }))
    yield* sql.withTransaction(Effect.andThen(storeResources(resources.ids), insertRows('INSERT INTO logs', rows)))
    yield* Ref.update(storedLogs, stored => stored + logs.length)
    yield* pruneNow(retention)
    return logs.length
  }, orDieOnStorage)

  const ingestMetrics = Effect.fn('trace repo ingest metrics')(function* (points: readonly NormalizedMetricPoint[], retention: Retention) {
    if (points.length === 0) return 0
    const receivedMs = yield* Clock.currentTimeMillis
    const rows = points.map(point => ({
      name: point.name,
      service: point.service,
      type: point.type,
      unit: point.unit,
      description: point.description,
      monotonic: point.monotonic ? 1 : 0,
      temporality: point.temporality,
      attributes: JSON.stringify(point.attributes),
      time_us: point.timeUs,
      value: point.value,
      count: point.count,
      sum: point.sum,
      received_ms: receivedMs,
    }))
    yield* sql.withTransaction(insertRows('INSERT INTO metric_points', rows))
    yield* Ref.update(storedMetricPoints, stored => stored + points.length)
    yield* pruneNow(retention)
    return points.length
  }, orDieOnStorage)

  const prune = Effect.fn('trace repo prune')(function* (retention: Retention) {
    return yield* pruneNow(retention)
  }, orDieOnStorage)

  const searchLogs = Effect.fn('trace repo search logs')(function* (query: LogSearchQuery) {
    const limit = query.limit ?? 100
    const conditions: Statement.Fragment[] = []
    if (query.service !== undefined) conditions.push(sql`l.service = ${query.service}`)
    if (query.minSeverity !== undefined) conditions.push(sql`l.severity_number >= ${query.minSeverity}`)
    if (query.traceId !== undefined) conditions.push(sql`l.trace_id = ${query.traceId.toLowerCase()}`)
    if (query.spanId !== undefined) conditions.push(sql`l.span_id = ${query.spanId.toLowerCase()}`)
    if (query.sessionId !== undefined)
      conditions.push(
        sql`(l.trace_id IN (SELECT trace_id FROM spans WHERE session_id = ${query.sessionId}) OR json_extract(l.attributes, '$."dsh.session.id"') = ${query.sessionId})`,
      )
    if (query.fromMs !== undefined) conditions.push(sql`l.time_us >= ${Math.round(query.fromMs * 1000)}`)
    if (query.toMs !== undefined) conditions.push(sql`l.time_us < ${Math.round(query.toMs * 1000)}`)
    if (query.attribute !== undefined)
      conditions.push(sql`CAST(json_extract(l.attributes, ${`$."${query.attribute.key}"`}) AS TEXT) = ${query.attribute.value}`)
    if (query.search !== undefined) {
      const pattern = `%${escapeLike(query.search)}%`
      conditions.push(sql`(l.body LIKE ${pattern} ESCAPE '\\' OR l.attributes LIKE ${pattern} ESCAPE '\\' OR l.event_name LIKE ${pattern} ESCAPE '\\')`)
    }
    if (query.cursor !== undefined) {
      const match = logCursor.exec(query.cursor)
      if (match?.[1] === undefined || match[2] === undefined) return yield* new InvalidCursor({ list: 'logs' })
      const timeUs = Number(match[1])
      conditions.push(sql`(l.time_us < ${timeUs} OR (l.time_us = ${timeUs} AND l.id < ${Number(match[2])}))`)
    }
    const rows = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: logRow,
      execute: () =>
        sql`SELECT l.id, l.time_us, l.severity_number, l.severity_text, l.body, l.service, l.scope, l.trace_id, l.span_id, l.event_name, l.attributes,
             r.attributes AS resource
           FROM logs l LEFT JOIN resources r ON r.id = l.resource_id ${whereOf(conditions)} ORDER BY l.time_us DESC, l.id DESC LIMIT ${limit + 1}`,
    })(undefined)
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
        attributes: row.attributes,
        resource: row.resource ?? {},
      })),
      nextCursor: rows.length > limit && last !== undefined ? `${String(last.time_us)}:${String(last.id)}` : null,
    } satisfies LogList
  }, orDieOnStorage)

  const listMetrics = Effect.fn('trace repo list metrics')(function* (query: {
    readonly windowMinutes: number
    readonly service?: string | undefined
    readonly search?: string | undefined
  }) {
    const sinceUs = ((yield* Clock.currentTimeMillis) - query.windowMinutes * 60_000) * 1000
    const conditions = [sql`m.time_us >= ${sinceUs}`]
    if (query.service !== undefined) conditions.push(sql`m.service = ${query.service}`)
    if (query.search !== undefined) {
      const pattern = `%${escapeLike(query.search)}%`
      conditions.push(sql`(m.name LIKE ${pattern} ESCAPE '\\' OR m.description LIKE ${pattern} ESCAPE '\\')`)
    }
    const rows = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: metricListRow,
      execute: () =>
        sql`SELECT m.service, m.name, MAX(m.type) AS type, MAX(m.unit) AS unit, MAX(m.description) AS description, COUNT(*) AS points,
           COUNT(DISTINCT m.attributes) AS series, MAX(m.time_us) AS last_us,
           (SELECT l.value FROM metric_points l WHERE l.service = m.service AND l.name = m.name ORDER BY l.time_us DESC, l.id DESC LIMIT 1) AS last_value
         FROM metric_points m ${whereOf(conditions)} GROUP BY m.service, m.name ORDER BY m.service, m.name LIMIT 500`,
    })(undefined)
    return rows.map((row): MetricSummary => ({
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
  }, orDieOnStorage)

  /**
   * One metric's series over a window, at most 20 series of 500 points. A cumulative monotonic sum (a counter) becomes
   * its increase between points, since its raw value only ever climbs; a reset (the value drops) starts again from it.
   */
  const metricSeries = Effect.fn('trace repo metric series')(function* (query: {
    readonly name: string
    readonly service: string
    readonly windowMinutes: number
  }) {
    const sinceUs = ((yield* Clock.currentTimeMillis) - query.windowMinutes * 60_000) * 1000
    const rows = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: metricPointRow,
      execute: () =>
        sql`SELECT type, unit, description, monotonic, temporality, attributes, time_us, value FROM metric_points
         WHERE service = ${query.service} AND name = ${query.name} AND time_us >= ${sinceUs} ORDER BY attributes, time_us`,
    })(undefined)
    const first = rows[0]
    if (first === undefined) return yield* new MetricNotFound({ name: query.name, service: query.service })
    const counter = first.type === 'sum' && first.monotonic === 1 && first.temporality === 'cumulative'
    const valueKind = counter ? 'increase' : first.type === 'gauge' || first.type === 'sum' ? 'value' : 'mean'
    const grouped = [...LatencyStats.groupBy(rows, row => row.attributes).entries()]
    const series = yield* Effect.forEach(grouped.slice(0, MAX_METRIC_SERIES), ([attributes, points]) =>
      Effect.map(Schema.decodeUnknownEffect(attributesJson)(attributes), decoded => {
        const values = points.flatMap(point => (point.value === null ? [] : [{ timeMs: usToMs(point.time_us), value: point.value }]))
        const charted = counter
          ? values.slice(1).map((point, index) => {
              const previous = values[index]?.value ?? 0
              return { timeMs: point.timeMs, value: point.value >= previous ? point.value - previous : point.value }
            })
          : values
        return { attributes: decoded, points: charted.slice(-MAX_SERIES_POINTS) }
      }),
    )
    return {
      service: query.service,
      name: query.name,
      type: first.type,
      unit: first.unit,
      description: first.description,
      valueKind,
      truncatedSeries: Math.max(0, grouped.length - MAX_METRIC_SERIES),
      series,
    } satisfies MetricSeries
  }, orDieOnStorage)

  const list = Effect.fn('trace repo list')(function* (query: TraceListQuery) {
    const limit = query.limit ?? 50
    const conditions: Statement.Fragment[] = []
    if (query.service !== undefined) conditions.push(sql`EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND s.service = ${query.service})`)
    if (query.operation !== undefined) conditions.push(sql`EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND s.name = ${query.operation})`)
    if (query.status === 'error') conditions.push(sql`t.error_count > 0`)
    if (query.status === 'ok') conditions.push(sql`t.error_count = 0`)
    if (query.minDurationMs !== undefined) conditions.push(sql`(t.end_us - t.start_us) >= ${Math.round(query.minDurationMs * 1000)}`)
    if (query.fromMs !== undefined) conditions.push(sql`t.start_us >= ${Math.round(query.fromMs * 1000)}`)
    if (query.toMs !== undefined) conditions.push(sql`t.start_us < ${Math.round(query.toMs * 1000)}`)
    if (query.sessionId !== undefined) conditions.push(sql`t.trace_id IN (SELECT trace_id FROM spans WHERE session_id = ${query.sessionId})`)
    if (query.turn !== undefined)
      conditions.push(
        query.sessionId === undefined
          ? sql`EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND ${attribute('dsh.turn')} = ${query.turn})`
          : sql`EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND ${attribute('dsh.turn')} = ${query.turn} AND s.session_id = ${query.sessionId})`,
      )
    if (query.search !== undefined) {
      const pattern = `%${escapeLike(query.search)}%`
      conditions.push(
        sql`(t.trace_id = ${query.search.toLowerCase()} OR EXISTS (SELECT 1 FROM spans s WHERE s.trace_id = t.trace_id AND (s.name LIKE ${pattern} ESCAPE '\\' OR s.attributes LIKE ${pattern} ESCAPE '\\' OR s.status_message LIKE ${pattern} ESCAPE '\\')))`,
      )
    }
    if (query.cursor !== undefined) {
      const match = traceCursor.exec(query.cursor)
      if (match?.[1] === undefined || match[2] === undefined) return yield* new InvalidCursor({ list: 'traces' })
      const startUs = Number(match[1])
      conditions.push(sql`(t.start_us < ${startUs} OR (t.start_us = ${startUs} AND t.trace_id < ${match[2]}))`)
    }
    const rows = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: traceRow,
      execute: () =>
        sql`SELECT trace_id, root_name, root_service, start_us, end_us, span_count, error_count, services, session_id,
             (SELECT SUM(${modelCallCost}) FROM spans s WHERE s.trace_id = t.trace_id) AS cost_usd
           FROM traces t ${whereOf(conditions)}
           ORDER BY t.start_us DESC, t.trace_id DESC LIMIT ${limit + 1}`,
    })(undefined)
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
        services: row.services,
        sessionId: row.session_id,
        costUsd: row.cost_usd,
      })),
      nextCursor: rows.length > limit && last !== undefined ? `${String(last.start_us)}:${last.trace_id}` : null,
    } satisfies TraceList
  }, orDieOnStorage)

  const spansOf = SqlSchema.findAll({
    Request: Schema.String,
    Result: spanRow,
    execute: traceId =>
      sql`SELECT s.span_id, s.parent_span_id, s.name, s.service, s.scope, s.kind, s.start_us, s.end_us, s.status_code, s.status_message, s.session_id,
             s.attributes, r.attributes AS resource, s.events, s.link_count
           FROM spans s LEFT JOIN resources r ON r.id = s.resource_id WHERE s.trace_id = ${traceId}`,
  })

  const trace = Effect.fn('trace repo trace')(function* (requestedId: string) {
    const traceId = requestedId.toLowerCase()
    const rows = yield* spansOf(traceId)
    if (rows.length === 0) return yield* new TraceNotFound({ traceId: requestedId })
    const startUs = Math.min(...rows.map(row => row.start_us))
    const endUs = Math.max(...rows.map(row => row.end_us))
    const tree = buildSpanTree(rows.map(row => ({ ...row, spanId: row.span_id, parentSpanId: row.parent_span_id, startUs: row.start_us })))
    return {
      traceId,
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
        attributes: entry.span.attributes,
        resource: entry.span.resource ?? {},
        events: entry.span.events.map(event => ({ name: event.name, offsetMs: usToMs(event.timeUs - startUs), attributes: event.attributes })),
        linkCount: entry.span.link_count,
      })),
    } satisfies TraceDetail
  }, orDieOnStorage)

  /** Model calls per service and model over a window: calls, gen_ai.usage token sums and the dshx.cost.usd sum. */
  const modelUsageOf = SqlSchema.findAll({
    Request: Schema.Struct({ sinceUs: Schema.Number, service: Schema.UndefinedOr(Schema.String) }),
    Result: modelUsageRow,
    execute: query =>
      sql`SELECT s.service, ${attribute('gen_ai.provider.name')} AS provider, COALESCE(${attribute('gen_ai.request.model')}, s.name) AS model,
           COUNT(*) AS calls, SUM(${attribute('gen_ai.usage.input_tokens')}) AS input_tokens,
           SUM(${attribute('gen_ai.usage.output_tokens')}) AS output_tokens, SUM(${attribute(SpanCost.attributeKey)}) AS cost_usd
         FROM spans s WHERE s.start_us >= ${query.sinceUs} AND ${isModelCall}${query.service === undefined ? sql.literal('') : sql` AND s.service = ${query.service}`}
         GROUP BY 1, 2, 3 ORDER BY cost_usd IS NULL, cost_usd DESC, calls DESC LIMIT 50`,
  })

  const spanStats = SqlSchema.findAll({
    Request: Schema.Struct({ sinceUs: Schema.Number, service: Schema.UndefinedOr(Schema.String) }),
    Result: spanStatRow,
    execute: query =>
      query.service === undefined
        ? sql`SELECT service, name, end_us - start_us AS duration_us, status_code FROM spans WHERE start_us >= ${query.sinceUs}`
        : sql`SELECT service, name, end_us - start_us AS duration_us, status_code FROM spans WHERE start_us >= ${query.sinceUs} AND service = ${query.service}`,
  })

  const statsOf = Effect.fnUntraced(function* (query: { readonly windowMinutes: number; readonly service?: string | undefined; readonly limit: number }) {
    const sinceUs = ((yield* Clock.currentTimeMillis) - query.windowMinutes * 60_000) * 1000
    const samples = (yield* spanStats({ sinceUs, service: query.service })).map(row => ({
      service: row.service,
      name: row.name,
      durationMs: usToMs(row.duration_us),
      error: row.status_code === 2,
    }))
    const models = (yield* modelUsageOf({ sinceUs, service: query.service })).map((row): ModelUsage => ({
      service: row.service,
      provider: row.provider,
      model: row.model,
      calls: row.calls,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
      costUsd: row.cost_usd,
    }))
    const byCount = <Entry extends { readonly count: number }>(left: Entry, right: Entry): number => right.count - left.count
    return {
      windowMinutes: query.windowMinutes,
      spans: samples.length,
      models,
      services: [...LatencyStats.groupBy(samples, sample => sample.service)]
        .map(([service, group]) => ({ service, ...LatencyStats.summarize(group) }))
        .sort(byCount),
      operations: [...LatencyStats.groupBy(samples, sample => `${sample.service}\u0000${sample.name}`).values()]
        .map(group => ({ service: group[0]?.service ?? '', name: group[0]?.name ?? '', ...LatencyStats.summarize(group) }))
        .sort(byCount)
        .slice(0, query.limit),
    } satisfies TraceStats
  })

  const stats = Effect.fn('trace repo stats')(function* (query: {
    readonly windowMinutes: number
    readonly service?: string | undefined
    readonly limit: number
  }) {
    return yield* statsOf(query)
  }, orDieOnStorage)

  const errorSpans = SqlSchema.findAll({
    Request: Schema.Number,
    Result: errorSpanRow,
    execute: sinceUs =>
      sql`SELECT service, name, error_type, status_message, start_us, trace_id, span_id FROM spans WHERE status_code = 2 AND start_us >= ${sinceUs} ORDER BY start_us DESC`,
  })

  const errorGroups = Effect.fn('trace repo error groups')(function* (query: { readonly windowMinutes: number; readonly limit: number }) {
    const sinceUs = ((yield* Clock.currentTimeMillis) - query.windowMinutes * 60_000) * 1000
    const rows = yield* errorSpans(sinceUs)
    return [...LatencyStats.groupBy(rows, row => [row.service, row.name, row.error_type ?? '', messageShape(row.status_message) ?? ''].join('\u0000')).values()]
      .flatMap((group): ErrorGroup[] => {
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
  }, orDieOnStorage)

  const serviceCalls = SqlSchema.findAll({
    Request: Schema.Number,
    Result: serviceCallRow,
    execute: sinceUs =>
      sql`SELECT p.service AS source, c.service AS target, c.end_us - c.start_us AS duration_us, c.status_code
         FROM spans c JOIN spans p ON p.trace_id = c.trace_id AND p.span_id = c.parent_span_id
         WHERE c.start_us >= ${sinceUs} AND p.service <> c.service`,
  })

  /** Calls between services: a span whose parent belongs to another service is one call from the parent's service. */
  const serviceMap = Effect.fn('trace repo service map')(function* (query: { readonly windowMinutes: number }) {
    const sinceUs = ((yield* Clock.currentTimeMillis) - query.windowMinutes * 60_000) * 1000
    const calls = (yield* serviceCalls(sinceUs)).map(row => ({
      source: row.source,
      target: row.target,
      durationMs: usToMs(row.duration_us),
      error: row.status_code === 2,
    }))
    const nodes = (yield* statsOf({ windowMinutes: query.windowMinutes, limit: 1 })).services
    return {
      windowMinutes: query.windowMinutes,
      nodes,
      edges: [...LatencyStats.groupBy(calls, call => `${call.source}\u0000${call.target}`).values()]
        .map(group => ({ source: group[0]?.source ?? '', target: group[0]?.target ?? '', ...LatencyStats.summarize(group) }))
        .sort((left, right) => right.count - left.count),
    } satisfies ServiceMap
  }, orDieOnStorage)

  const sessionSpans = SqlSchema.findAll({
    Request: Schema.String,
    Result: sessionSpanRow,
    execute: sessionId =>
      sql`SELECT s.trace_id, s.name, s.service, s.start_us, s.end_us, s.status_code, s.session_id AS span_session_id,
           ${modelCallCost} AS cost_usd,
           ${attribute('dsh.turn')} AS turn,
           ${attribute('gen_ai.operation.name')} AS operation,
           ${attribute('gen_ai.usage.input_tokens')} AS input_tokens,
           ${attribute('gen_ai.usage.output_tokens')} AS output_tokens,
           COALESCE(${attribute('gen_ai.usage.cache_read.input_tokens')}, ${attribute('gen_ai.usage.cache_read_input_tokens')}) AS cache_read_tokens,
           ${attribute('gen_ai.usage.reasoning_tokens')} AS reasoning_tokens
         FROM spans s WHERE s.trace_id IN (SELECT trace_id FROM spans WHERE session_id = ${sessionId})`,
  })

  /**
   * Everything one DSH Session sent: every span of the traces that carry its `dsh.session.id` anywhere (so plugin spans
   * nested under a turn count), classified by the GenAI `gen_ai.operation.name` (span-name prefix as a fallback).
   * Token totals come from model-call spans only: the turn span repeats them as its own totals.
   */
  const sessionSummary = Effect.fn('trace repo session summary')(function* (sessionId: string) {
    const rows = yield* sessionSpans(sessionId)
    const classified = rows.map(row => ({ ...row, kind: operationOf(row) }))
    const modelCalls = classified.filter(row => row.kind === 'model')
    const earliest = (group: readonly SessionSpanRow[]): number => group.reduce((least, row) => Math.min(least, row.start_us), Number.POSITIVE_INFINITY)
    const latest = (group: readonly SessionSpanRow[]): number => group.reduce((most, row) => Math.max(most, row.end_us), 0)
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
      totalTraceMs: traces.reduce((total, entry) => total + entry.durationMs, 0),
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
    } satisfies SessionSummary
  }, orDieOnStorage)

  const spanSamples = Effect.fn('trace repo span samples')(function* (query: SpanSampleQuery) {
    const sinceUs = Math.round(query.endedAfterMs * 1000)
    const conditions = [sql`s.start_us >= ${sinceUs - SAMPLE_LOOKBACK_US}`, sql`s.end_us >= ${sinceUs}`]
    if (query.service !== null) conditions.push(sql`s.service = ${query.service}`)
    if (query.operation !== null) {
      const prefix = query.operation.endsWith('*') ? query.operation.slice(0, -1) : null
      conditions.push(prefix === null ? sql`s.name = ${query.operation}` : sql`s.name LIKE ${`${escapeLike(prefix)}%`} ESCAPE '\\'`)
    }
    if (query.attribute !== null) {
      const path = `$."${query.attribute.key}"`
      conditions.push(
        query.attribute.value === '*'
          ? sql`json_extract(s.attributes, ${path}) IS NOT NULL`
          : sql`CAST(json_extract(s.attributes, ${path}) AS TEXT) = ${query.attribute.value}`,
      )
    }
    const group = query.groupAttribute === undefined ? sql.literal('NULL') : sql`CAST(json_extract(s.attributes, ${`$."${query.groupAttribute}"`}) AS TEXT)`
    const measure = query.measureAttribute === undefined ? sql.literal('NULL') : sql`json_extract(s.attributes, ${`$."${query.measureAttribute}"`})`
    const rows = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: spanSampleRow,
      execute: () =>
        sql`SELECT s.trace_id, s.name, s.service, s.end_us - s.start_us AS duration_us, s.status_code, COALESCE(s.session_id, t.session_id) AS session_id,
           ${group} AS group_value, ${measure} AS measure_value
         FROM spans s LEFT JOIN traces t ON t.trace_id = s.trace_id ${whereOf(conditions)} ORDER BY s.end_us DESC LIMIT ${query.limit + 1}`,
    })(undefined)
    return {
      truncated: rows.length > query.limit,
      samples: rows.slice(0, query.limit).map((row): SpanSample => ({
        traceId: row.trace_id,
        name: row.name,
        service: row.service,
        durationMs: usToMs(row.duration_us),
        error: row.status_code === 2,
        sessionId: row.session_id,
        group: row.group_value,
        measure: typeof row.measure_value === 'number' ? row.measure_value : null,
      })),
    } satisfies SpanSamples
  }, orDieOnStorage)

  const summaryRow = SqlSchema.findOne({
    Request: Schema.Void,
    Result: storeSummaryRow,
    execute: () => sql`SELECT COUNT(*) AS traces, MIN(start_us) AS oldest, MAX(start_us) AS newest FROM traces`,
  })

  const summaryNow = Effect.gen(function* () {
    const row = yield* summaryRow(undefined)
    return {
      spans: yield* spanCount,
      traces: row.traces,
      logs: yield* Ref.get(storedLogs),
      metricPoints: yield* Ref.get(storedMetricPoints),
      oldestMs: row.oldest === null ? null : usToMs(row.oldest),
      newestMs: row.newest === null ? null : usToMs(row.newest),
    } satisfies StoreSummary
  })

  const summary = Effect.fn('trace repo summary')(function* () {
    return yield* summaryNow
  }, orDieOnStorage)

  const clear = Effect.fn('trace repo clear')(function* () {
    const removed = yield* sql.withTransaction(
      Effect.gen(function* () {
        const before = yield* summaryNow
        yield* scriptOf('DELETE FROM spans; DELETE FROM traces; DELETE FROM logs; DELETE FROM metric_points; DELETE FROM resources;').pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
        )
        return {
          removedSpans: before.spans,
          removedTraces: before.traces,
          removedLogs: before.logs,
          removedMetricPoints: before.metricPoints,
        } satisfies ClearResult
      }),
    )
    yield* Ref.set(storedLogs, 0)
    yield* Ref.set(storedMetricPoints, 0)
    return removed
  }, orDieOnStorage)

  return TraceRepo.of({
    ingestSpans,
    ingestLogs,
    ingestMetrics,
    prune,
    list,
    trace,
    stats,
    errorGroups,
    serviceMap,
    sessionSummary,
    searchLogs,
    listMetrics,
    metricSeries,
    spanSamples,
    summary,
    clear,
  })
})

/** Spans, logs and metric points received over OTLP, and every read the panel, the tools and the alert engine make of them. */
export class TraceRepo extends Context.Service<
  TraceRepo,
  {
    readonly ingestSpans: (spans: readonly NormalizedSpan[], retention: Retention) => Effect.Effect<{ readonly stored: number; readonly prunedTraces: number }>
    readonly ingestLogs: (logs: readonly NormalizedLog[], retention: Retention) => Effect.Effect<number>
    readonly ingestMetrics: (points: readonly NormalizedMetricPoint[], retention: Retention) => Effect.Effect<number>
    readonly prune: (retention: Retention) => Effect.Effect<number>
    readonly list: (query: TraceListQuery) => Effect.Effect<TraceList, InvalidCursor>
    readonly trace: (traceId: string) => Effect.Effect<TraceDetail, TraceNotFound>
    readonly stats: (query: { readonly windowMinutes: number; readonly service?: string | undefined; readonly limit: number }) => Effect.Effect<TraceStats>
    readonly errorGroups: (query: { readonly windowMinutes: number; readonly limit: number }) => Effect.Effect<ErrorGroup[]>
    readonly serviceMap: (query: { readonly windowMinutes: number }) => Effect.Effect<ServiceMap>
    readonly sessionSummary: (sessionId: string) => Effect.Effect<SessionSummary>
    readonly searchLogs: (query: LogSearchQuery) => Effect.Effect<LogList, InvalidCursor>
    readonly listMetrics: (query: {
      readonly windowMinutes: number
      readonly service?: string | undefined
      readonly search?: string | undefined
    }) => Effect.Effect<MetricSummary[]>
    readonly metricSeries: (query: {
      readonly name: string
      readonly service: string
      readonly windowMinutes: number
    }) => Effect.Effect<MetricSeries, MetricNotFound>
    readonly spanSamples: (query: SpanSampleQuery) => Effect.Effect<SpanSamples>
    readonly summary: () => Effect.Effect<StoreSummary>
    readonly clear: () => Effect.Effect<ClearResult>
  }
>()('@dshfiles/traces/TraceRepo') {
  static readonly layer = Layer.effect(TraceRepo, make)
}
