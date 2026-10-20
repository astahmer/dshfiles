/**
 * The owned derived index. It is a plain FTS5 table over bounded document text plus one row per session log cursor, so
 * a pass can resume where it stopped and a search is a single read-only query. Every row that crosses out of SQLite is
 * decoded once with a schema, so no dictionary-typed value reaches the rest of the plugin.
 */
import { mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { withoutUndefined } from './optional-fields.js'
import type { EventFilters, IndexHealth, SearchMatch, SessionEventSearchRequest, SessionHeaderRow, SessionSearchRequest } from './protocol.js'
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

const numberLike = z.union([z.number(), z.bigint()]).transform(Number)
const nullableString = z.string().nullable()

const cursorRowSchema = z.object({
  id: z.string(),
  log_path: z.string(),
  log_dev: z.string(),
  log_ino: z.string(),
  log_offset: numberLike,
  log_size: numberLike,
  log_mtime_ns: z.string(),
})

const sessionRowSchema = z.object({
  id: z.string(),
  version: numberLike,
  created_at: numberLike,
  cwd: nullableString,
  parent_session: nullableString,
  seed_length: numberLike.nullable(),
  delegation_depth: numberLike.nullable(),
  agent_preset: nullableString,
})

const rankedRowSchema = sessionRowSchema.extend({
  session_id: z.string(),
  seq: numberLike,
  type: z.string(),
  time: numberLike,
  surface: z.string(),
  marked_text: z.string(),
})

const countRowSchema = z.object({ count: numberLike })

const documentRowidSchema = z.object({ document_rowid: numberLike })

export interface SessionCursor {
  readonly id: string
  readonly logPath: string
  readonly dev: string
  readonly ino: string
  readonly offset: number
  readonly size: number
  readonly mtimeNs: string
}

export interface DocumentRow {
  readonly sessionId: string
  readonly seq: number
  readonly type: string
  readonly time: number
  readonly surface: string
  readonly text: string
  readonly truncated: boolean
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

type SessionRow = z.infer<typeof sessionRowSchema>
type RankedRow = z.infer<typeof rankedRowSchema>

const headerOf = (
  row: Pick<SessionRow, 'id' | 'version' | 'created_at' | 'cwd' | 'parent_session' | 'seed_length' | 'delegation_depth' | 'agent_preset'>,
): SessionHeaderRow =>
  withoutUndefined(
    sessionHeaderSchema.parse({
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

const metaValueSchema = z.object({ value: z.string() })
const backfillRowSchema = z.object({
  rowid: numberLike,
  text: z.string(),
  session_id: z.string(),
  seq: numberLike,
  type: z.string(),
  time: numberLike,
  surface: z.string(),
  truncated: numberLike,
})

export class SearchIndex {
  readonly #database: DatabaseSync
  readonly #path: string

  constructor(path: string) {
    this.#path = path
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.#database = new DatabaseSync(path)
    this.#database.exec('PRAGMA journal_mode = wal')
    this.#database.exec('PRAGMA synchronous = normal')
    this.#database.exec(SCHEMA)
  }

  cursor(sessionId: string): SessionCursor | undefined {
    const value = this.#database.prepare('SELECT id, log_path, log_dev, log_ino, log_offset, log_size, log_mtime_ns FROM sessions WHERE id = ?').get(sessionId)
    const parsed = cursorRowSchema.safeParse(value)
    if (!parsed.success) return undefined
    return {
      id: parsed.data.id,
      logPath: parsed.data.log_path,
      dev: parsed.data.log_dev,
      ino: parsed.data.log_ino,
      offset: parsed.data.log_offset,
      size: parsed.data.log_size,
      mtimeNs: parsed.data.log_mtime_ns,
    }
  }

  /** Store the session header plus the newest cursor after a committed batch. */
  commitBatch(input: BatchInput): void {
    const { header, cursor, documents, replace, now } = input
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      if (replace) {
        this.#deleteSessionRows(header.id)
        this.#database.prepare('DELETE FROM sessions WHERE id = ?').run(header.id)
      }
      if (documents.length > 0) {
        const insert = this.#database.prepare(
          'INSERT INTO session_documents (text, session_id, seq, type, time, surface, truncated) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        const remember = this.#database.prepare('INSERT INTO session_document_rows (session_id, document_rowid) VALUES (?, ?)')
        for (const document of documents) {
          const inserted = insert.run(
            document.text,
            document.sessionId,
            document.seq,
            document.type,
            document.time,
            document.surface,
            document.truncated ? 1 : 0,
          )
          remember.run(header.id, Number(inserted.lastInsertRowid))
          if (isConversation(document))
            this.#database
              .prepare('INSERT INTO conversation_documents (rowid, text, session_id, seq, type, time, surface, truncated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
              .run(
                inserted.lastInsertRowid,
                document.text,
                document.sessionId,
                document.seq,
                document.type,
                document.time,
                document.surface,
                document.truncated ? 1 : 0,
              )
        }
      }
      const truncated = documents.reduce((total, document) => total + (document.truncated ? 1 : 0), 0)
      this.#database
        .prepare(
          `INSERT INTO sessions (id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset,
             log_path, log_dev, log_ino, log_offset, log_size, log_mtime_ns, indexed_at, documents_count, truncated_documents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             version = excluded.version, created_at = excluded.created_at, cwd = excluded.cwd, parent_session = excluded.parent_session,
             seed_length = excluded.seed_length, delegation_depth = excluded.delegation_depth, agent_preset = excluded.agent_preset,
             log_path = excluded.log_path, log_dev = excluded.log_dev, log_ino = excluded.log_ino, log_offset = excluded.log_offset,
             log_size = excluded.log_size, log_mtime_ns = excluded.log_mtime_ns, indexed_at = excluded.indexed_at,
             documents_count = sessions.documents_count + excluded.documents_count, truncated_documents = sessions.truncated_documents + excluded.truncated_documents`,
        )
        .run(
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
        )
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  /** Forget a session whose log was rewritten, so the next pass indexes it from the start. */
  forget(sessionId: string): void {
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      this.#deleteSessionRows(sessionId)
      this.#database.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
      this.#database.exec('COMMIT')
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * Delete one session's documents through the rowid mapping, because a predicate on `session_id` inside
   * the FTS5 table scans every document in the index (measured 532 ms on a 982 MB index) while an FTS5
   * delete by rowid is a direct write. A Session indexed before this mapping existed has no rows here:
   * it takes the one scanning delete, and everything indexed afterwards stays on the rowid path.
   */
  #deleteSessionRows(sessionId: string): void {
    const mapped = this.#database.prepare('SELECT document_rowid FROM session_document_rows WHERE session_id = ?').all(sessionId)
    if (mapped.length === 0) {
      this.#database.prepare('DELETE FROM session_documents WHERE session_id = ?').run(sessionId)
      this.#database.prepare('DELETE FROM conversation_documents WHERE session_id = ?').run(sessionId)
      return
    }
    const remove = this.#database.prepare('DELETE FROM session_documents WHERE rowid = ?')
    const removeConversation = this.#database.prepare('DELETE FROM conversation_documents WHERE rowid = ?')
    for (const row of mapped) {
      const rowid = documentRowidSchema.parse(row).document_rowid
      remove.run(rowid)
      removeConversation.run(rowid)
    }
    this.#database.prepare('DELETE FROM session_document_rows WHERE session_id = ?').run(sessionId)
  }

  #meta(key: string): string | undefined {
    const parsed = metaValueSchema.safeParse(this.#database.prepare('SELECT value FROM meta WHERE key = ?').get(key))
    return parsed.success ? parsed.data.value : undefined
  }

  #setMeta(key: string, value: string): void {
    this.#database.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  /** Whether `conversation_documents` holds every conversation document, so searches may use it. */
  get conversationReady(): boolean {
    return this.#meta('conversation_ready') === '1'
  }

  /**
   * Copy the next `rowids` rowids of conversation documents indexed before `conversation_documents` existed. Documents
   * committed since are written to both tables, so the copy stops at the highest rowid it saw first.
   * @returns whether the copy is complete.
   */
  backfillConversation(rowids: number): boolean {
    if (this.conversationReady) return true
    this.#database.exec('BEGIN IMMEDIATE')
    try {
      let until = Number(this.#meta('conversation_backfill_until') ?? Number.NaN)
      if (Number.isNaN(until)) {
        until = numberLike.parse(this.#database.prepare('SELECT coalesce(max(rowid), 0) AS value FROM session_documents').get()?.['value'] ?? 0)
        this.#setMeta('conversation_backfill_until', String(until))
      }
      const from = Number(this.#meta('conversation_backfill_from') ?? '0')
      const to = Math.min(until, from + rowids)
      const copy = this.#database.prepare(
        'INSERT OR REPLACE INTO conversation_documents (rowid, text, session_id, seq, type, time, surface, truncated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const raw of this.#database
        .prepare('SELECT rowid, text, session_id, seq, type, time, surface, truncated FROM session_documents WHERE rowid > ? AND rowid <= ?')
        .all(from, to)) {
        const row = backfillRowSchema.parse(raw)
        if (isConversation(row)) copy.run(row.rowid, row.text, row.session_id, row.seq, row.type, row.time, row.surface, row.truncated)
      }
      this.#setMeta('conversation_backfill_from', String(to))
      if (to >= until) this.#setMeta('conversation_ready', '1')
      this.#database.exec('COMMIT')
      return to >= until
    } catch (error) {
      this.#database.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * The table a filtered search reads: the conversation subset when the filters ask for exactly it (the user and/or
   * assistant messages of the current surface), with the clauses that subset already satisfies dropped.
   */
  #route(filters: EventFilters | undefined): SearchRoute {
    if (filters === undefined || !this.conversationReady) return { table: 'session_documents', filters }
    const types = filters.filter(filter => filter.kind === 'type')
    const surfaces = filters.filter(filter => filter.kind === 'surface')
    const [type] = types
    const [surface] = surfaces
    if (types.length !== 1 || surfaces.length !== 1 || type === undefined || surface === undefined) return { table: 'session_documents', filters }
    if (surface.values.length !== 1 || surface.values[0] !== CONVERSATION_SURFACE) return { table: 'session_documents', filters }
    if (type.values.length === 0 || !type.values.every(value => CONVERSATION_TYPES.has(value))) return { table: 'session_documents', filters }
    const coversEveryType = [...CONVERSATION_TYPES].every(value => type.values.includes(value))
    return {
      table: 'conversation_documents',
      filters: filters.filter(filter => filter.kind !== 'surface' && (filter.kind !== 'type' || !coversEveryType)),
    }
  }

  searchSessions(request: SessionSearchRequest): SearchRows {
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
    const route = this.#route(request.filters)
    const events = eventFilterClauses(route.filters)
    filters.push(...events.clauses)
    bindings.push(...events.bindings)
    const rows = this.#rankedRows({
      table: route.table,
      filters,
      bindings,
      limit: request.limit + 1,
      offset: request.cursor ?? 0,
      sessionId: undefined,
      query: request.query,
    })
    return { matches: rows.slice(0, request.limit).map(row => this.#match(row)), hasMore: rows.length > request.limit }
  }

  searchEvents(request: SessionEventSearchRequest): EventSearchRows {
    const route = this.#route(request.filters)
    const events = eventFilterClauses(route.filters)
    const rows = this.#rankedRows({
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
      header: first === undefined ? this.sessionHeader(request.sessionId) : this.#match(first).header,
      matches: rows.slice(0, request.limit).map(row => this.#match(row)),
      hasMore: rows.length > request.limit,
    }
  }

  sessionHeader(sessionId: string): SessionHeaderRow | null {
    const value = this.#database
      .prepare('SELECT id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset FROM sessions WHERE id = ?')
      .get(sessionId)
    const parsed = sessionRowSchema.safeParse(value)
    return parsed.success ? headerOf(parsed.data) : null
  }

  /**
   * The best-ranked document of each matching session, best sessions first. A common term matches ~100 000 documents
   * here, so this ranks first and builds snippets for the returned rows only (snippet() re-tokenizes a whole document),
   * and scores only the best `rankCap` documents through FTS5's ordered `rank` scan. Walking documents in rank order
   * keeps the first one of each session, so the cap only loses sessions past it; a capped answer shorter than asked is
   * recomputed over every match.
   */
  #rankedRows(input: {
    readonly table: DocumentTable
    readonly query: string
    readonly filters: readonly string[]
    readonly bindings: readonly (string | number)[]
    readonly limit: number
    readonly offset: number
    readonly sessionId: string | undefined
  }): readonly RankedRow[] {
    const rankCap = Math.max(RANK_CAP, (input.offset + input.limit) * 50)
    const capped = this.#rankedRowsWithin({ ...input, rankCap })
    return capped.length >= input.limit ? capped : this.#rankedRowsWithin({ ...input, rankCap: undefined })
  }

  #rankedRowsWithin(input: {
    readonly table: DocumentTable
    readonly query: string
    readonly filters: readonly string[]
    readonly bindings: readonly (string | number)[]
    readonly limit: number
    readonly offset: number
    readonly sessionId: string | undefined
    readonly rankCap: number | undefined
  }): readonly RankedRow[] {
    const table = input.table
    const where = [`${table} MATCH ?`, ...(input.sessionId === undefined ? [] : ['d.session_id = ?']), ...input.filters].join(' AND ')
    const bindings: (string | number)[] = [
      input.query,
      ...(input.sessionId === undefined ? [] : [input.sessionId]),
      ...input.bindings,
      ...(input.rankCap === undefined ? [] : [input.rankCap]),
      input.limit,
      input.offset,
      input.query,
    ]
    const sql = `
      WITH matched AS (
        SELECT d.rowid AS document_rowid, d.session_id AS session_id, d.seq AS seq, d.time AS time,
               ${input.rankCap === undefined ? `bm25(${table})` : 'rank'} AS score, length(d.text) AS document_length
        FROM ${table} AS d JOIN sessions AS s ON s.id = d.session_id
        WHERE ${where}${input.rankCap === undefined ? '' : ' ORDER BY rank LIMIT ?'}
      ),
      ranked AS (
        SELECT document_rowid, session_id, seq, time, score, document_length,
               row_number() OVER (PARTITION BY session_id ORDER BY score ASC, document_length ASC, time DESC, seq DESC) AS event_rank
        FROM matched
      ),
      page AS (
        SELECT document_rowid, score, document_length, time, session_id, seq FROM ranked WHERE event_rank = 1
        ORDER BY score ASC, document_length ASC, time DESC, session_id ASC, seq DESC
        LIMIT ? OFFSET ?
      )
      SELECT d.session_id AS session_id, d.seq AS seq, d.type AS type, d.time AS time, d.surface AS surface,
             s.id AS id, s.version AS version, s.created_at AS created_at, s.cwd AS cwd, s.parent_session AS parent_session,
             s.seed_length AS seed_length, s.delegation_depth AS delegation_depth, s.agent_preset AS agent_preset,
             snippet(${table}, 0, ?, ?, '…', 32) AS marked_text
      FROM page JOIN ${table} AS d ON d.rowid = page.document_rowid JOIN sessions AS s ON s.id = page.session_id
      WHERE ${table} MATCH ?
      ORDER BY page.score ASC, page.document_length ASC, page.time DESC, page.session_id ASC, page.seq DESC
    `
    const values = this.#database.prepare(sql).all(...bindings.slice(0, -1), MARKER_START, MARKER_END, input.query)
    return values.map(value => rankedRowSchema.parse(value))
  }

  #match(row: RankedRow): SearchMatch {
    return {
      sessionId: row.session_id,
      seq: row.seq,
      type: row.type,
      time: row.time,
      surface: row.surface,
      snippet: DocumentText.snippet(row.marked_text, 240),
      header: headerOf(row),
    }
  }

  health(input: {
    readonly behindSessions: number
    readonly behindBytes: number
    readonly ingesting: boolean
    readonly lastIngestMs: number
    readonly slowestIngestMs: number
    readonly lastSearchMs: number
    readonly slowestSearchMs: number
    readonly lastError: string | null
  }): IndexHealth {
    const sessions = countRowSchema.parse(this.#database.prepare('SELECT count(*) AS count FROM sessions').get()).count
    // `commitBatch` maintains `documents_count` on every append, replace and forget, so the sum is the
    // FTS5 row count without scanning the virtual table (measured 572 ms per `count(*)` at 982 MB).
    const documents = countRowSchema.parse(this.#database.prepare('SELECT COALESCE(SUM(documents_count), 0) AS count FROM sessions').get()).count
    let indexBytes = 0
    for (const suffix of ['', '-wal', '-shm']) indexBytes += statSize(`${this.#path}${suffix}`)
    return { sessions, documents, indexBytes, ...input }
  }

  close(): void {
    this.#database.close()
  }
}

const statSize = (path: string): number => {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
