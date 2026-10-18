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
import type { IndexHealth, SearchMatch, SessionEventSearchRequest, SessionHeaderRow, SessionSearchRequest } from './protocol.js'
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
  readonly cursor: { readonly logPath: string; readonly dev: string; readonly ino: string; readonly offset: number; readonly size: number; readonly mtimeNs: string }
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

const headerOf = (row: Pick<SessionRow, 'id' | 'version' | 'created_at' | 'cwd' | 'parent_session' | 'seed_length' | 'delegation_depth' | 'agent_preset'>): SessionHeaderRow =>
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
    const value = this.#database
      .prepare('SELECT id, log_path, log_dev, log_ino, log_offset, log_size, log_mtime_ns FROM sessions WHERE id = ?')
      .get(sessionId)
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
        const insert = this.#database.prepare('INSERT INTO session_documents (text, session_id, seq, type, time, surface, truncated) VALUES (?, ?, ?, ?, ?, ?, ?)')
        for (const document of documents) insert.run(document.text, document.sessionId, document.seq, document.type, document.time, document.surface, document.truncated ? 1 : 0)
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

  #deleteSessionRows(sessionId: string): void {
    this.#database.prepare('DELETE FROM session_documents WHERE session_id = ?').run(sessionId)
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
    const rows = this.#rankedRows({ filters, bindings, limit: request.limit + 1, offset: request.cursor ?? 0, sessionId: undefined, query: request.query })
    return { matches: rows.slice(0, request.limit).map(row => this.#match(row)), hasMore: rows.length > request.limit }
  }

  searchEvents(request: SessionEventSearchRequest): EventSearchRows {
    const rows = this.#rankedRows({ filters: [], bindings: [], limit: request.limit + 1, offset: request.cursor ?? 0, sessionId: request.sessionId, query: request.query })
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

  #rankedRows(input: {
    readonly query: string
    readonly filters: readonly string[]
    readonly bindings: readonly (string | number)[]
    readonly limit: number
    readonly offset: number
    readonly sessionId: string | undefined
  }): readonly RankedRow[] {
    const where = ['session_documents MATCH ?', ...(input.sessionId === undefined ? [] : ['d.session_id = ?']), ...input.filters].join(' AND ')
    const bindings: (string | number)[] = [input.query, ...(input.sessionId === undefined ? [] : [input.sessionId]), ...input.bindings, input.limit, input.offset]
    const sql = `
      WITH matched AS (
        SELECT d.session_id AS session_id, d.seq AS seq, d.type AS type, d.time AS time, d.surface AS surface,
               s.id AS id, s.version AS version, s.created_at AS created_at, s.cwd AS cwd, s.parent_session AS parent_session,
               s.seed_length AS seed_length, s.delegation_depth AS delegation_depth, s.agent_preset AS agent_preset,
               bm25(session_documents) AS score, length(d.text) AS document_length,
               snippet(session_documents, 0, ?, ?, '…', 32) AS marked_text
        FROM session_documents AS d JOIN sessions AS s ON s.id = d.session_id
        WHERE ${where}
      ),
      ranked AS (
        SELECT session_id, seq, type, time, surface, id, version, created_at, cwd, parent_session, seed_length, delegation_depth,
               agent_preset, marked_text, score, document_length,
               row_number() OVER (PARTITION BY session_id ORDER BY score ASC, document_length ASC, time DESC, seq DESC) AS event_rank
        FROM matched
      )
      SELECT session_id, seq, type, time, surface, id, version, created_at, cwd, parent_session, seed_length, delegation_depth, agent_preset, marked_text
      FROM ranked WHERE event_rank = 1
      ORDER BY score ASC, document_length ASC, time DESC, session_id ASC, seq DESC
      LIMIT ? OFFSET ?
    `
    const values = this.#database.prepare(sql).all(MARKER_START, MARKER_END, ...bindings)
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

  health(input: { readonly behindSessions: number; readonly behindBytes: number; readonly ingesting: boolean; readonly lastIngestMs: number; readonly lastError: string | null }): IndexHealth {
    const sessions = countRowSchema.parse(this.#database.prepare('SELECT count(*) AS count FROM sessions').get()).count
    const documents = countRowSchema.parse(this.#database.prepare('SELECT count(*) AS count FROM session_documents').get()).count
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
