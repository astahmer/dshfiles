/**
 * The owned derived index. It is a plain FTS5 table over bounded document text plus one row per session log cursor, so
 * a pass can resume where it stopped and a search is a single read-only query. Every row that crosses out of SQLite is
 * decoded once with a schema, so no dictionary-typed value reaches the rest of the plugin.
 */
import { statSync } from 'node:fs'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { SqlClient } from 'effect/sql'
import * as SchemaGetter from 'effect/SchemaGetter'
import type { HistoryPrompt, IndexHealth, PromptHistoryRequest } from './api-schemas.js'
import { withoutUndefined } from './optional-fields.js'
import type { EventFilters, FindInSessionRequest, SearchMatch, SessionEventSearchRequest, SessionHeaderRow, SessionSearchRequest } from './protocol.js'
import { sessionHeaderSchema } from './protocol.js'
import { DocumentText } from './text.js'

const MARKER_START = '\uFDD0'
const MARKER_END = '\uFDD1'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  cwd TEXT,
  parent_session TEXT,
  seed_length INTEGER,
  delegation_depth INTEGER,
  agent_preset TEXT,
  log_path TEXT NOT NULL,
  log_dev TEXT NOT NULL,
  log_ino TEXT NOT NULL,
  log_offset INTEGER NOT NULL,
  log_size INTEGER NOT NULL,
  log_mtime_ns TEXT NOT NULL,
  indexed_at INTEGER NOT NULL,
  documents_count INTEGER NOT NULL DEFAULT 0,
  truncated_documents INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS session_documents USING fts5(
  text,
  session_id UNINDEXED,
  seq UNINDEXED,
  type UNINDEXED,
  time UNINDEXED,
  surface UNINDEXED,
  truncated UNINDEXED,
  tokenize = 'unicode61'
);

-- The user/assistant messages of each session's current surface, under the same rowids: the subset both callers
-- search (90 000 of 560 000 documents here), so a filtered search reads neither other documents nor their rows.
CREATE VIRTUAL TABLE IF NOT EXISTS conversation_documents USING fts5(
  text,
  session_id UNINDEXED,
  seq UNINDEXED,
  type UNINDEXED,
  time UNINDEXED,
  surface UNINDEXED,
  truncated UNINDEXED,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS session_document_rows (
  session_id TEXT NOT NULL,
  document_rowid INTEGER NOT NULL,
  PRIMARY KEY (session_id, document_rowid)
) STRICT;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`

/**
 * One row per user message of a session's current surface whose text the index kept whole, keyed by its document rowid.
 * The prompt history reads it in time order through an ordinary index instead of scanning FTS rows. `human` is 1 for a
 * prompt a person sent, 0 for one a plugin or agent sent, NULL for rows indexed before the flag existed.
 */
const USER_PROMPTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_prompts (
  document_rowid INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  time INTEGER NOT NULL,
  chars INTEGER NOT NULL,
  human INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS user_prompts_time ON user_prompts (time);
CREATE INDEX IF NOT EXISTS user_prompts_session ON user_prompts (session_id);
INSERT OR IGNORE INTO user_prompts (document_rowid, session_id, seq, time, chars, human)
  SELECT rowid, session_id, seq, time, length(text), NULL FROM session_documents
  WHERE type = 'user/message' AND surface = 'current' AND truncated = 0
`

const runStatements = (schema: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    for (const statement of schema.split(';').map(part => part.trim())) {
      if (statement.length > 0) yield* sql.unsafe(statement)
    }
  })

export const indexMigrations = {
  '1_initial_schema': runStatements(SCHEMA),
  '2_user_prompts': runStatements(USER_PROMPTS_SCHEMA),
}

/** SQLite hands back an integer as either a number or a bigint depending on its size. */
const numberLike = Schema.Union([Schema.Number, Schema.BigInt]).pipe(
  Schema.decodeTo(Schema.Number, {
    decode: SchemaGetter.transform((value: number | bigint) => Number(value)),
    encode: SchemaGetter.transform((value: number) => value),
  }),
)
const nullableString = Schema.NullOr(Schema.String)

const cursorRowSchema = Schema.Struct({
  id: Schema.String,
  log_path: Schema.String,
  log_dev: Schema.String,
  log_ino: Schema.String,
  log_offset: numberLike,
  log_size: numberLike,
  log_mtime_ns: Schema.String,
})

const sessionRowSchema = Schema.Struct({
  id: Schema.String,
  version: numberLike,
  created_at: numberLike,
  cwd: nullableString,
  parent_session: nullableString,
  seed_length: Schema.NullOr(numberLike),
  delegation_depth: Schema.NullOr(numberLike),
  agent_preset: nullableString,
})

const rankedRowSchema = Schema.Struct({
  ...sessionRowSchema.fields,
  session_id: Schema.String,
  seq: numberLike,
  type: Schema.String,
  time: numberLike,
  surface: Schema.String,
  marked_text: Schema.String,
})

const findRowSchema = Schema.Struct({ seq: numberLike, type: Schema.String, time: numberLike, marked_text: Schema.String })

const historyRowSchema = Schema.Struct({ session_id: Schema.String, seq: numberLike, time: numberLike, text: Schema.String })

/** Rows read per returned prompt, so repeated prompts collapsing into one still fill the page. */
const HISTORY_OVERFETCH = 4

const isUserPrompt = (document: DocumentRow): boolean => document.type === 'user/message' && document.surface === CONVERSATION_SURFACE && !document.truncated

/** A find shows one line per match, shorter than a session search's excerpt. */
const FIND_SNIPPET_CHARS = 160

const countRowSchema = Schema.Struct({ count: numberLike })
const pageCountRowSchema = Schema.Struct({ page_count: numberLike })
const freelistRowSchema = Schema.Struct({ freelist_count: numberLike })

const documentRowidSchema = Schema.Struct({ document_rowid: numberLike })
const insertedRowSchema = Schema.Struct({ lastInsertRowid: numberLike })
const DOCUMENT_INSERT_CHUNK = 100
// One synchronous FTS5 INSERT is the longest a search can wait behind this worker, so a chunk is bounded by text bytes
// too: 100 capped 64 KB documents are 6.4 MB in one native call. The batch stays inside the group transaction, which is
// what keeps the WAL commits and the FTS5 segment writes unchanged.
const DOCUMENT_INSERT_BYTES = 1024 * 1024

type DocumentChunk = { readonly start: number; readonly end: number }

const documentChunks = (documents: readonly DocumentRow[]): readonly DocumentChunk[] => {
  const chunks: DocumentChunk[] = []
  let start = 0
  let bytes = 0
  for (const [index, document] of documents.entries()) {
    const size = Buffer.byteLength(document.text)
    if (index > start && (index - start >= DOCUMENT_INSERT_CHUNK || bytes + size > DOCUMENT_INSERT_BYTES)) {
      chunks.push({ start, end: index })
      start = index
      bytes = 0
    }
    bytes += size
  }
  if (start < documents.length) chunks.push({ start, end: documents.length })
  return chunks
}

export interface SessionCursor {
  readonly id: string
  readonly logPath: string
  readonly dev: string
  readonly ino: string
  readonly offset: number
  readonly size: number
  readonly mtimeNs: string
}

const CURSOR_SELECT = 'SELECT id, log_path, log_dev, log_ino, log_offset, log_size, log_mtime_ns FROM sessions'
const CURSOR_BY_ID = `${CURSOR_SELECT} WHERE id = ?`

// oxlint-disable-next-line antislop/no-unknown-parameters -- the row is parsed with cursorRowSchema immediately.
const cursorOf = (row: unknown): SessionCursor | undefined => {
  const parsed = Schema.decodeUnknownResult(cursorRowSchema)(row)
  if (parsed._tag === 'Failure') return undefined
  return {
    id: parsed.success.id,
    logPath: parsed.success.log_path,
    dev: parsed.success.log_dev,
    ino: parsed.success.log_ino,
    offset: parsed.success.log_offset,
    size: parsed.success.log_size,
    mtimeNs: parsed.success.log_mtime_ns,
  }
}

export interface DocumentRow {
  readonly sessionId: string
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly surface: string
  readonly text: string
  readonly truncated: boolean
  /** For a user message: whether a person sent it rather than a plugin or agent; absent when unknown. */
  readonly humanPrompt?: boolean
}

export interface BatchInput {
  readonly header: SessionHeaderRow
  readonly cursor: {
    readonly logPath: string
    readonly dev: string
    readonly ino: string
    readonly offset: number
    readonly size: number
    readonly mtimeNs: string
  }
  readonly documents: readonly DocumentRow[]
  readonly replace: boolean
  readonly now: number
}

export type SearchRows = {
  readonly matches: readonly SearchMatch[]
  readonly hasMore: boolean
}

export type EventSearchRows = SearchRows & {
  readonly header: SessionHeaderRow | null
}

type SessionRow = typeof sessionRowSchema.Type
type RankedRow = typeof rankedRowSchema.Type

const headerOf = (
  row: Pick<SessionRow, 'id' | 'version' | 'created_at' | 'cwd' | 'parent_session' | 'seed_length' | 'delegation_depth' | 'agent_preset'>,
): SessionHeaderRow =>
  withoutUndefined(
    Schema.decodeUnknownSync(sessionHeaderSchema)({
      version: row.version,
      id: row.id,
      createdAt: row.created_at,
      cwd: row.cwd ?? undefined,
      parentSession: row.parent_session ?? undefined,
      isSeeded: row.seed_length !== null,
      delegationDepth: row.delegation_depth ?? undefined,
      agentPreset: row.agent_preset ?? undefined,
    }),
  )

/** Translate host-side event clauses into SQL that runs before ranking; clauses are ANDed, values inside one are ORed. */
const eventFilterClauses = (filters: EventFilters | undefined) => {
  const clauses: string[] = []
  const bindings: (string | number)[] = []
  for (const filter of filters ?? []) {
    switch (filter.kind) {
      case 'type':
      case 'surface': {
        const column = filter.kind === 'type' ? 'd.type' : 'd.surface'
        clauses.push(`${column} IN (${filter.values.map(() => '?').join(', ')})`)
        bindings.push(...filter.values)
        break
      }
      case 'seq': {
        if (filter.from !== undefined) {
          clauses.push('d.seq >= ?')
          bindings.push(filter.from)
        }
        if (filter.to !== undefined) {
          clauses.push('d.seq <= ?')
          bindings.push(filter.to)
        }
        break
      }
      case 'time': {
        if (filter.from !== undefined) {
          clauses.push('d.time >= ?')
          bindings.push(filter.from)
        }
        if (filter.to !== undefined) {
          clauses.push('d.time <= ?')
          bindings.push(filter.to)
        }
        break
      }
    }
  }
  return { clauses, bindings }
}

/** Documents a search scores before it falls back to every match; see `#rankedRows`. */
const RANK_CAP = 2_000

const CONVERSATION_TYPES: ReadonlySet<string> = new Set(['user/message', 'assistant/message'])
const CONVERSATION_SURFACE = 'current'
const isConversation = (document: { readonly type: string; readonly surface: string }): boolean =>
  CONVERSATION_TYPES.has(document.type) && document.surface === CONVERSATION_SURFACE

type DocumentTable = 'session_documents' | 'conversation_documents'

/** The FTS table a search reads and the filter clauses still left to apply on it. */
type SearchRoute = { readonly table: DocumentTable; readonly filters: EventFilters | undefined }

const metaValueSchema = Schema.Struct({ value: Schema.String })
const backfillRowSchema = Schema.Struct({
  rowid: numberLike,
  text: Schema.String,
  session_id: Schema.String,
  seq: numberLike,
  type: Schema.String,
  time: numberLike,
  surface: Schema.String,
  truncated: numberLike,
})

export class SearchIndex {
  constructor(
    readonly sql: SqlClient.SqlClient,
    readonly path = ':memory:',
  ) {}

  readonly cursor = (sessionId: string) => Effect.map(this.sql.unsafe(CURSOR_BY_ID, [sessionId]), rows => cursorOf(rows[0]))

  readonly cursors = () =>
    Effect.map(this.sql.unsafe(CURSOR_SELECT), rows => {
      const cursors = new Map<string, SessionCursor>()
      for (const row of rows) {
        const cursor = cursorOf(row)
        if (cursor !== undefined) cursors.set(cursor.id, cursor)
      }
      return cursors
    })

  readonly deleteSessionRows = (sessionId: string) =>
    Effect.gen({ self: this }, function* () {
      const mapped = yield* this.sql.unsafe('SELECT document_rowid FROM session_document_rows WHERE session_id = ?', [sessionId])
      if (mapped.length === 0) {
        const rows = yield* this.sql.unsafe('SELECT documents_count AS count FROM sessions WHERE id = ?', [sessionId])
        const counted = Schema.decodeUnknownResult(countRowSchema)(rows[0])
        if (counted._tag === 'Failure' || counted.success.count === 0) return
        yield* this.sql.unsafe('DELETE FROM session_documents WHERE session_id = ?', [sessionId])
        yield* this.sql.unsafe('DELETE FROM conversation_documents WHERE session_id = ?', [sessionId])
        yield* this.sql.unsafe('DELETE FROM user_prompts WHERE session_id = ?', [sessionId])
        return
      }
      const rowids = mapped.map(row => Schema.decodeUnknownSync(documentRowidSchema)(row).document_rowid)
      // One statement per chunk: a per-row delete cost a statement per document, the dominant cost of a full reindex.
      for (let start = 0; start < rowids.length; start += DOCUMENT_INSERT_CHUNK) {
        const chunk = rowids.slice(start, start + DOCUMENT_INSERT_CHUNK)
        const placeholders = chunk.map(() => '?').join(', ')
        yield* this.sql.unsafe(`DELETE FROM session_documents WHERE rowid IN (${placeholders})`, chunk)
        yield* this.sql.unsafe(`DELETE FROM conversation_documents WHERE rowid IN (${placeholders})`, chunk)
      }
      yield* this.sql.unsafe('DELETE FROM session_document_rows WHERE session_id = ?', [sessionId])
      yield* this.sql.unsafe('DELETE FROM user_prompts WHERE session_id = ?', [sessionId])
    })

  readonly forget = (sessionId: string) =>
    this.sql.withTransaction(
      Effect.gen({ self: this }, function* () {
        yield* this.deleteSessionRows(sessionId)
        yield* this.sql.unsafe('DELETE FROM sessions WHERE id = ?', [sessionId])
        yield* this.bumpRevision
      }),
    )

  /** Bumped by every corpus write, so a page cursor issued before one is known stale: pages are offsets over rank. */
  readonly bumpRevision = Effect.suspend(() =>
    this.sql.unsafe(
      "INSERT INTO meta (key, value) VALUES ('corpus_revision', '1') ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)",
    ),
  )

  readonly revision = () => Effect.map(this.meta('corpus_revision'), value => value ?? '0')

  readonly commitBatch = (input: BatchInput) =>
    this.sql.withTransaction(
      Effect.gen({ self: this }, function* () {
        const { header, cursor, documents, replace, now } = input
        if (replace) {
          yield* this.deleteSessionRows(header.id)
          yield* this.sql.unsafe('DELETE FROM sessions WHERE id = ?', [header.id])
        }
        const rowids: number[] = []
        const chunks = documentChunks(documents)
        // One statement per chunk: FTS5 assigns rowids from the current maximum upward, so a contiguous chunk yields
        // contiguous rowids and no document needs a read back to learn its rowid.
        for (const chunk of chunks) {
          const chunkDocuments = documents.slice(chunk.start, chunk.end)
          const values: (string | number)[] = []
          for (const document of chunkDocuments)
            values.push(document.text, document.sessionId, document.seq, document.type, document.time, document.surface, document.truncated ? 1 : 0)
          const placeholders = chunkDocuments.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')
          const inserted = yield* this.sql.unsafe(
            `INSERT INTO session_documents (text, session_id, seq, type, time, surface, truncated) VALUES ${placeholders}`,
            values,
          ).raw
          const chunkLast = Schema.decodeUnknownSync(insertedRowSchema)(inserted).lastInsertRowid
          const chunkFirst = chunkLast - chunkDocuments.length + 1
          for (let index = 0; index < chunkDocuments.length; index += 1) rowids.push(chunkFirst + index)
        }
        for (const chunk of chunks) {
          const chunkDocuments = documents.slice(chunk.start, chunk.end)
          const chunkRowids = rowids.slice(chunk.start, chunk.end)
          const mappingValues: (string | number)[] = []
          for (const rowid of chunkRowids) mappingValues.push(header.id, rowid)
          yield* this.sql.unsafe(
            `INSERT INTO session_document_rows (session_id, document_rowid) VALUES ${chunkRowids.map(() => '(?, ?)').join(', ')}`,
            mappingValues,
          )
          const conversation: (string | number)[] = []
          const conversationPlaceholders: string[] = []
          for (const [index, document] of chunkDocuments.entries()) {
            if (!isConversation(document)) continue
            conversationPlaceholders.push('(?, ?, ?, ?, ?, ?, ?, ?)')
            conversation.push(
              chunkRowids[index] ?? 0,
              document.text,
              document.sessionId,
              document.seq,
              document.type,
              document.time,
              document.surface,
              document.truncated ? 1 : 0,
            )
          }
          if (conversationPlaceholders.length > 0)
            yield* this.sql.unsafe(
              `INSERT INTO conversation_documents (rowid, text, session_id, seq, type, time, surface, truncated) VALUES ${conversationPlaceholders.join(', ')}`,
              conversation,
            )
          const prompts: (string | number | null)[] = []
          const promptPlaceholders: string[] = []
          for (const [index, document] of chunkDocuments.entries()) {
            if (!isUserPrompt(document)) continue
            promptPlaceholders.push('(?, ?, ?, ?, ?, ?)')
            const human = document.humanPrompt === undefined ? null : document.humanPrompt ? 1 : 0
            prompts.push(chunkRowids[index] ?? 0, document.sessionId, document.seq, document.time, document.text.length, human)
          }
          if (promptPlaceholders.length > 0)
            yield* this.sql.unsafe(
              `INSERT OR REPLACE INTO user_prompts (document_rowid, session_id, seq, time, chars, human) VALUES ${promptPlaceholders.join(', ')}`,
              prompts,
            )
        }
        const truncated = documents.reduce((total, document) => total + (document.truncated ? 1 : 0), 0)
        yield* this.sql.unsafe(
          `INSERT INTO sessions (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset,
               log_path, log_dev, log_ino, log_offset, log_size, log_mtime_ns, indexed_at, documents_count, truncated_documents)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
               version = excluded.version, created_at = excluded.created_at, cwd = excluded.cwd, parent_session = excluded.parent_session,
               seed_length = excluded.seed_length, delegation_depth = excluded.delegation_depth, agent_preset = excluded.agent_preset,
               log_path = excluded.log_path, log_dev = excluded.log_dev, log_ino = excluded.log_ino, log_offset = excluded.log_offset,
               log_size = excluded.log_size, log_mtime_ns = excluded.log_mtime_ns, indexed_at = excluded.indexed_at,
               documents_count = sessions.documents_count + excluded.documents_count, truncated_documents = sessions.truncated_documents + excluded.truncated_documents`,
          [
            header.id,
            header.version,
            header.createdAt,
            header.cwd ?? null,
            header.parentSession ?? null,
            header.isSeeded ? 0 : null,
            header.delegationDepth ?? null,
            header.agentPreset ?? null,
            cursor.logPath,
            cursor.dev,
            cursor.ino,
            cursor.offset,
            cursor.size,
            cursor.mtimeNs,
            now,
            documents.length,
            truncated,
          ],
        )
        yield* this.bumpRevision
      }),
    )

  readonly meta = (key: string) =>
    Effect.map(this.sql.unsafe('SELECT value FROM meta WHERE key = ?', [key]), rows => {
      const parsed = Schema.decodeUnknownResult(metaValueSchema)(rows[0])
      return parsed._tag === 'Success' ? parsed.success.value : undefined
    })

  readonly setMeta = (key: string, value: string) =>
    this.sql.unsafe('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value])

  readonly conversationReady = () => Effect.map(this.meta('conversation_ready'), value => value === '1')

  readonly backfillConversation = (rowids: number) =>
    this.sql.withTransaction(
      Effect.gen({ self: this }, function* () {
        if ((yield* this.meta('conversation_ready')) === '1') return true
        let until = Number((yield* this.meta('conversation_backfill_until')) ?? Number.NaN)
        if (Number.isNaN(until)) {
          const rows = yield* this.sql.unsafe('SELECT coalesce(max(rowid), 0) AS value FROM session_documents')
          const first = Schema.decodeUnknownSync(Schema.Struct({ value: numberLike }))(rows[0])
          until = first.value
          yield* this.setMeta('conversation_backfill_until', String(until))
        }
        const from = Number((yield* this.meta('conversation_backfill_from')) ?? '0')
        const to = Math.min(until, from + rowids)
        const rows = yield* this.sql.unsafe(
          'SELECT rowid, text, session_id, seq, type, time, surface, truncated FROM session_documents WHERE rowid > ? AND rowid <= ?',
          [from, to],
        )
        for (const raw of rows) {
          const row = Schema.decodeUnknownSync(backfillRowSchema)(raw)
          if (isConversation(row))
            yield* this.sql.unsafe(
              'INSERT OR REPLACE INTO conversation_documents (rowid, text, session_id, seq, type, time, surface, truncated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [row.rowid, row.text, row.session_id, row.seq, row.type, row.time, row.surface, row.truncated],
            )
        }
        yield* this.setMeta('conversation_backfill_from', String(to))
        if (to >= until) yield* this.setMeta('conversation_ready', '1')
        return to >= until
      }),
    )

  readonly route = (filters: EventFilters | undefined) =>
    Effect.gen({ self: this }, function* () {
      if (filters === undefined || (yield* this.meta('conversation_ready')) !== '1') return { table: 'session_documents', filters } satisfies SearchRoute
      const types = filters.filter(filter => filter.kind === 'type')
      const surfaces = filters.filter(filter => filter.kind === 'surface')
      const [type] = types
      const [surface] = surfaces
      if (types.length !== 1 || surfaces.length !== 1 || type === undefined || surface === undefined)
        return { table: 'session_documents', filters } satisfies SearchRoute
      if (surface.values.length !== 1 || surface.values[0] !== CONVERSATION_SURFACE) return { table: 'session_documents', filters } satisfies SearchRoute
      if (type.values.length === 0 || !type.values.every(value => CONVERSATION_TYPES.has(value)))
        return { table: 'session_documents', filters } satisfies SearchRoute
      const coversEveryType = [...CONVERSATION_TYPES].every(value => type.values.includes(value))
      return {
        table: 'conversation_documents',
        filters: filters.filter(filter => filter.kind !== 'surface' && (filter.kind !== 'type' || !coversEveryType)),
      } satisfies SearchRoute
    })

  readonly rankedRows = (input: {
    readonly table: DocumentTable
    readonly query: string
    readonly filters: readonly string[]
    readonly bindings: readonly (string | number)[]
    readonly limit: number
    readonly offset: number
    readonly sessionId: string | undefined
  }) =>
    Effect.gen({ self: this }, function* () {
      const read = (rankCap: number | undefined) => {
        const table = input.table
        const where = [`${table} MATCH ?`, ...(input.sessionId === undefined ? [] : ['d.session_id = ?']), ...input.filters].join(' AND ')
        const values = [
          input.query,
          ...(input.sessionId === undefined ? [] : [input.sessionId]),
          ...input.bindings,
          ...(rankCap === undefined ? [] : [rankCap]),
          input.limit,
          input.offset,
          MARKER_START,
          MARKER_END,
          input.query,
        ]
        return Effect.map(
          this.sql.unsafe(
            `
        WITH matched AS (
          SELECT d.rowid AS document_rowid, d.session_id AS session_id, d.seq AS seq, d.time AS time,
                 ${rankCap === undefined ? `bm25(${table})` : 'rank'} AS score, length(d.text) AS document_length
          FROM ${table} AS d JOIN sessions AS s ON s.id = d.session_id
          WHERE ${where}${rankCap === undefined ? '' : ' ORDER BY rank LIMIT ?'}
        ), ranked AS (
          SELECT document_rowid, session_id, seq, time, score, document_length,
                 row_number() OVER (PARTITION BY session_id ORDER BY score ASC, document_length ASC, time DESC, seq DESC) AS event_rank
          FROM matched
        ), page AS (
          SELECT document_rowid, score, document_length, time, session_id, seq FROM ranked WHERE event_rank = 1
          ORDER BY score ASC, document_length ASC, time DESC, session_id ASC, seq DESC LIMIT ? OFFSET ?
        )
        SELECT d.session_id AS session_id, d.seq AS seq, d.type AS type, d.time AS time, d.surface AS surface,
               s.id AS id, s.version AS version, s.created_at AS created_at, s.cwd AS cwd, s.parent_session AS parent_session,
               s.seed_length AS seed_length, s.delegation_depth AS delegation_depth, s.agent_preset AS agent_preset,
               snippet(${table}, 0, ?, ?, '…', 32) AS marked_text
        FROM page JOIN ${table} AS d ON d.rowid = page.document_rowid JOIN sessions AS s ON s.id = page.session_id
        WHERE ${table} MATCH ?
        ORDER BY page.score ASC, page.document_length ASC, page.time DESC, page.session_id ASC, page.seq DESC
      `,
            values,
          ),
          rows => rows.map(row => Schema.decodeUnknownSync(rankedRowSchema)(row)),
        )
      }
      const capped = yield* read(Math.max(RANK_CAP, (input.offset + input.limit) * 50))
      return capped.length >= input.limit ? capped : yield* read(undefined)
    })

  readonly match = (row: RankedRow): SearchMatch => ({
    sessionId: row.session_id,
    seq: row.seq,
    type: row.type,
    time: row.time,
    surface: row.surface,
    snippet: DocumentText.snippet(row.marked_text, 240),
    header: headerOf(row),
  })

  readonly searchSessions = (request: SessionSearchRequest) =>
    Effect.gen({ self: this }, function* () {
      const filters: string[] = []
      const bindings: (string | number)[] = []
      if (request.sessionIds !== undefined && request.sessionIds.length > 0) {
        filters.push(`d.session_id IN (${request.sessionIds.map(() => '?').join(', ')})`)
        bindings.push(...request.sessionIds)
      }
      if (request.cwd !== undefined) {
        filters.push('s.cwd = ?')
        bindings.push(request.cwd)
      }
      const revision = yield* this.revision()
      const route = yield* this.route(request.filters)
      const events = eventFilterClauses(route.filters)
      const rows = yield* this.rankedRows({
        table: route.table,
        filters: [...filters, ...events.clauses],
        bindings: [...bindings, ...events.bindings],
        limit: request.limit + 1,
        offset: request.cursor ?? 0,
        sessionId: undefined,
        query: request.query,
      })
      return { matches: rows.slice(0, request.limit).map(this.match), hasMore: rows.length > request.limit, revision }
    })

  readonly sessionHeader = (sessionId: string) =>
    Effect.map(
      this.sql.unsafe('SELECT id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset FROM sessions WHERE id = ?', [
        sessionId,
      ]),
      rows => {
        const parsed = Schema.decodeUnknownResult(sessionRowSchema)(rows[0])
        return parsed._tag === 'Success' ? headerOf(parsed.success) : null
      },
    )

  readonly searchEvents = (request: SessionEventSearchRequest) =>
    Effect.gen({ self: this }, function* () {
      const revision = yield* this.revision()
      const route = yield* this.route(request.filters)
      const events = eventFilterClauses(route.filters)
      const rows = yield* this.rankedRows({
        table: route.table,
        filters: events.clauses,
        bindings: events.bindings,
        limit: request.limit + 1,
        offset: request.cursor ?? 0,
        sessionId: request.sessionId,
        query: request.query,
      })
      const first = rows[0]
      return {
        header: first === undefined ? yield* this.sessionHeader(request.sessionId) : this.match(first).header,
        matches: rows.slice(0, request.limit).map(this.match),
        hasMore: rows.length > request.limit,
        revision,
      }
    })

  readonly findInSession = (request: FindInSessionRequest) =>
    Effect.map(
      this.sql.unsafe(
        `SELECT d.seq AS seq, d.type AS type, d.time AS time, snippet(session_documents, 0, ?, ?, '…', 24) AS marked_text
      FROM session_documents AS d WHERE session_documents MATCH ? AND d.session_id = ? AND d.surface = 'current'
      ORDER BY d.seq ASC, d.rowid ASC LIMIT ?`,
        [MARKER_START, MARKER_END, request.query, request.sessionId, request.limit + 1],
      ),
      values => {
        const rows = values.map(value => Schema.decodeUnknownSync(findRowSchema)(value))
        return {
          matches: rows
            .slice(0, request.limit)
            .map(row => ({ seq: row.seq, type: row.type, time: row.time, snippet: DocumentText.snippet(row.marked_text, FIND_SNIPPET_CHARS) })),
          hasMore: rows.length > request.limit,
        }
      },
    )

  /**
   * The newest prompts people sent across top-level threads, newest first, each text once. Only the newest `window`
   * prompts no longer than `maxChars` are read; `query` (an FTS5 expression) narrows them. Subagent threads and
   * messages a plugin or agent sent are left out.
   */
  readonly promptHistory = (request: PromptHistoryRequest) =>
    Effect.gen({ self: this }, function* () {
      const table: DocumentTable = (yield* this.conversationReady()) ? 'conversation_documents' : 'session_documents'
      const match = request.query === undefined ? '' : `WHERE d.rowid IN (SELECT rowid FROM ${table} WHERE ${table} MATCH ?)`
      const bindings: (string | number)[] = [request.maxChars, request.window]
      if (request.query !== undefined) bindings.push(request.query)
      bindings.push(request.limit * HISTORY_OVERFETCH)
      const rows = yield* this.sql.unsafe(
        `WITH recent AS (
           SELECT p.document_rowid, p.session_id, p.seq, p.time FROM user_prompts AS p
           JOIN sessions AS s ON s.id = p.session_id
           WHERE p.human IS NOT 0 AND p.chars <= ? AND coalesce(s.delegation_depth, 0) = 0
           ORDER BY p.time DESC LIMIT ?
         )
         SELECT r.session_id AS session_id, r.seq AS seq, r.time AS time, d.text AS text
         FROM recent AS r JOIN ${table} AS d ON d.rowid = r.document_rowid ${match}
         ORDER BY r.time DESC, r.document_rowid DESC LIMIT ?`,
        bindings,
      )
      const seen = new Set<string>()
      const prompts: HistoryPrompt[] = []
      for (const value of rows) {
        const row = Schema.decodeUnknownSync(historyRowSchema)(value)
        const key = row.text.trim()
        if (key.length === 0 || seen.has(key)) continue
        seen.add(key)
        prompts.push({ sessionId: row.session_id, seq: row.seq, time: row.time, text: row.text })
        if (prompts.length === request.limit) break
      }
      return { prompts }
    })

  readonly vacuum = () => Effect.asVoid(this.sql.unsafe('VACUUM'))

  readonly compact = () =>
    Effect.gen({ self: this }, function* () {
      yield* this.sql.unsafe("INSERT INTO session_documents(session_documents) VALUES('optimize')")
      yield* this.sql.unsafe("INSERT INTO conversation_documents(conversation_documents) VALUES('optimize')")
      yield* this.sql.unsafe('VACUUM')
    })

  readonly freePageRatio = () =>
    Effect.gen({ self: this }, function* () {
      const pageRows = yield* this.sql.unsafe('PRAGMA page_count')
      const pages = Schema.decodeUnknownSync(pageCountRowSchema)(pageRows[0]).page_count
      if (pages === 0) return 0
      const freeRows = yield* this.sql.unsafe('PRAGMA freelist_count')
      return Schema.decodeUnknownSync(freelistRowSchema)(freeRows[0]).freelist_count / pages
    })

  readonly bytesPerDocument = () =>
    Effect.gen({ self: this }, function* () {
      const rows = yield* this.sql.unsafe('SELECT COALESCE(SUM(documents_count), 0) AS count FROM sessions')
      const documents = Schema.decodeUnknownSync(countRowSchema)(rows[0]).count
      if (documents === 0) return 0
      let bytes = 0
      for (const suffix of ['', '-wal', '-shm']) bytes += statSize(`${this.path}${suffix}`)
      return bytes / documents
    })

  readonly health = (input: Omit<IndexHealth, 'sessions' | 'documents' | 'indexBytes'>) =>
    Effect.gen({ self: this }, function* () {
      const sessionRows = yield* this.sql.unsafe('SELECT count(*) AS count FROM sessions')
      const documentRows = yield* this.sql.unsafe('SELECT COALESCE(SUM(documents_count), 0) AS count FROM sessions')
      const sessions = Schema.decodeUnknownSync(countRowSchema)(sessionRows[0]).count
      const documents = Schema.decodeUnknownSync(countRowSchema)(documentRows[0]).count
      let indexBytes = 0
      for (const suffix of ['', '-wal', '-shm']) indexBytes += statSize(`${this.path}${suffix}`)
      return { sessions, documents, indexBytes, ...input }
    })

  readonly backfillRowMap = (rowids: number) =>
    this.sql.withTransaction(
      Effect.gen({ self: this }, function* () {
        if ((yield* this.meta('row_map_ready')) === '1') return true
        let until = Number((yield* this.meta('row_map_backfill_until')) ?? Number.NaN)
        if (Number.isNaN(until)) {
          const rows = yield* this.sql.unsafe('SELECT coalesce(max(rowid), 0) AS value FROM session_documents')
          until = Schema.decodeUnknownSync(Schema.Struct({ value: numberLike }))(rows[0]).value
          yield* this.setMeta('row_map_backfill_until', String(until))
        }
        const from = Number((yield* this.meta('row_map_backfill_from')) ?? '0')
        const to = Math.min(until, from + rowids)
        yield* this.sql.unsafe(
          'INSERT OR IGNORE INTO session_document_rows (session_id, document_rowid) SELECT session_id, rowid FROM session_documents WHERE rowid > ? AND rowid <= ?',
          [from, to],
        )
        yield* this.setMeta('row_map_backfill_from', String(to))
        if (to >= until) yield* this.setMeta('row_map_ready', '1')
        return to >= until
      }),
    )
}

const statSize = (path: string): number => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
