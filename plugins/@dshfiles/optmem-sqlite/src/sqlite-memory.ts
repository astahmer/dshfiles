import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLOutputValue, type StatementSync } from 'node:sqlite'

import {
  StreamIds,
  type AppendedEvent,
  type EventMeta,
  type EventRole,
  type MemoryEvent,
  type MemoryNode,
  type MemorySearch,
  type MemoryStore,
  type NodeAddress,
  type StoredSearchHit,
  type StreamEntry,
  type StreamId,
  type ViewState,
} from '@dshfiles/optmem-core'

import { migrate } from './migrations.ts'

type Row = Record<string, SQLOutputValue>

const roles: readonly EventRole[] = ['user', 'assistant', 'tool_call', 'tool_result', 'note']

const integer = (row: Row, column: string): number => {
  const value = row[column]
  if (typeof value === 'number') return value
  if (typeof value === 'bigint') return Number(value)
  throw new Error(`optmem-sqlite: column ${column} is not an integer`)
}

const text = (row: Row, column: string): string => {
  const value = row[column]
  if (typeof value === 'string') return value
  throw new Error(`optmem-sqlite: column ${column} is not text`)
}

const nullableText = (row: Row, column: string): string | null => (row[column] === null ? null : text(row, column))

const stream = (row: Row, column: string): StreamId => {
  const parsed = StreamIds.parse(text(row, column))
  if (!parsed) throw new Error(`optmem-sqlite: invalid stream id in ${column}`)
  return parsed
}

const role = (row: Row): EventRole => {
  const value = text(row, 'role')
  const known = roles.find(candidate => candidate === value)
  if (!known) throw new Error(`optmem-sqlite: unknown role ${value}`)
  return known
}

const parseMeta = (json: string): EventMeta => {
  const parsed: unknown = JSON.parse(json)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const meta: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') meta[key] = value
  }
  return meta
}

const parseNodes = (json: string): readonly NodeAddress[] => {
  const parsed: unknown = JSON.parse(json)
  if (!Array.isArray(parsed)) throw new Error('optmem-sqlite: view nodes are not an array')
  return parsed.map((pair: unknown) => {
    if (!Array.isArray(pair) || typeof pair[0] !== 'number' || typeof pair[1] !== 'number') throw new Error('optmem-sqlite: invalid view node')
    return { level: pair[0], idx: pair[1] }
  })
}

const eventFromRow = (row: Row): MemoryEvent => ({
  id: integer(row, 'id'),
  eventKey: text(row, 'event_key'),
  harness: text(row, 'harness'),
  conversationId: text(row, 'conversation_id'),
  projectId: nullableText(row, 'project_id'),
  parentConversationId: nullableText(row, 'parent_conversation_id'),
  role: role(row),
  createdAt: integer(row, 'created_at'),
  text: text(row, 'text'),
  bytes: integer(row, 'bytes'),
  truncated: integer(row, 'truncated') === 1,
  meta: parseMeta(text(row, 'meta')),
})

const nodeFromRow = (row: Row): MemoryNode => ({
  stream: stream(row, 'stream'),
  address: { level: integer(row, 'level'), idx: integer(row, 'idx') },
  text: text(row, 'text'),
  bytes: integer(row, 'bytes'),
  eventId: row['event_id'] === null ? null : integer(row, 'event_id'),
  model: text(row, 'model'),
  createdAt: integer(row, 'created_at'),
})

const viewFromRow = (row: Row): ViewState => ({
  stream: stream(row, 'stream'),
  throughPos: integer(row, 'through_pos'),
  nodes: parseNodes(text(row, 'nodes')),
  rendered: text(row, 'rendered'),
  bytes: integer(row, 'bytes'),
  version: integer(row, 'version'),
  mergePending: integer(row, 'merge_pending') === 1,
})

/** Whitespace-separated chunks become quoted FTS5 phrases (implicit AND), so punctuation in code never breaks the query. */
const ftsQuery = (query: string): string =>
  query
    .split(/\s+/)
    .filter(chunk => chunk.length > 0)
    .map(chunk => `"${chunk.replaceAll('"', '""')}"`)
    .join(' ')

const ftsCursorStream = 'events'
const snippetTokens = 16

export type SqliteMemory = {
  readonly store: MemoryStore
  readonly search: MemorySearch
  /** Escape hatch for diagnostics, benchmarks and failure-injection tests. */
  readonly database: DatabaseSync
  close(): void
}

export type SqliteMemoryOptions = { readonly path: string; readonly busyTimeoutMs?: number | undefined }

const restrictPermissions = (path: string): void => {
  for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) chmodSync(file, 0o600)
}

export const openSqliteMemory = (options: SqliteMemoryOptions): SqliteMemory => {
  const inMemory = options.path === ':memory:'
  if (!inMemory) mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(options.path)
  database.exec(`PRAGMA busy_timeout = ${Math.trunc(options.busyTimeoutMs ?? 5_000)}`)
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA synchronous = NORMAL')
  database.exec('PRAGMA cache_size = -32768')
  database.exec('PRAGMA foreign_keys = ON')
  migrate(database)
  if (!inMemory) restrictPermissions(options.path)

  const statements = new Map<string, StatementSync>()
  const prepare = (sql: string): StatementSync => {
    const cached = statements.get(sql)
    if (cached) return cached
    const statement = database.prepare(sql)
    statements.set(sql, statement)
    return statement
  }

  const transaction = <Result>(mode: 'IMMEDIATE' | 'DEFERRED', work: () => Result): Result => {
    database.exec(`BEGIN ${mode}`)
    try {
      const result = work()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  const streamLength = (streamId: StreamId): number =>
    integer(prepare('SELECT COALESCE(MAX(pos) + 1, 0) AS length FROM stream_entries WHERE stream = ?').get(streamId) ?? { length: 0 }, 'length')

  const getNode = (streamId: StreamId, address: NodeAddress): MemoryNode | undefined => {
    const row = prepare('SELECT * FROM nodes WHERE stream = ? AND level = ? AND idx = ?').get(streamId, address.level, address.idx)
    return row ? nodeFromRow(row) : undefined
  }

  const getView = (streamId: StreamId): ViewState | undefined => {
    const row = prepare('SELECT * FROM views WHERE stream = ?').get(streamId)
    return row ? viewFromRow(row) : undefined
  }

  const store: MemoryStore = {
    appendEvents: async events =>
      transaction('IMMEDIATE', () =>
        events.map((event): AppendedEvent => {
          const inserted = prepare(
            `INSERT INTO events (event_key, harness, conversation_id, project_id, parent_conversation_id, role, created_at, text, bytes, truncated, meta)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_key) DO NOTHING RETURNING id`,
          ).get(
            event.eventKey,
            event.harness,
            event.conversationId,
            event.projectId,
            event.parentConversationId,
            event.role,
            event.createdAt,
            event.text,
            event.bytes,
            event.truncated ? 1 : 0,
            JSON.stringify(event.meta),
          )
          if (!inserted) {
            const existing = prepare('SELECT id FROM events WHERE event_key = ?').get(event.eventKey)
            if (!existing) throw new Error(`optmem-sqlite: event ${event.eventKey} vanished during append`)
            return { eventId: integer(existing, 'id'), eventKey: event.eventKey, inserted: false, entries: [] }
          }
          const eventId = integer(inserted, 'id')
          const entries = event.streams.map((streamId): StreamEntry => {
            const pos = streamLength(streamId)
            prepare('INSERT INTO stream_entries (stream, pos, event_id) VALUES (?, ?, ?)').run(streamId, pos, eventId)
            return { stream: streamId, pos }
          })
          return { eventId, eventKey: event.eventKey, inserted: true, entries }
        }),
      ),

    readStream: async (streamId, fromPos, toPos) =>
      prepare(
        `SELECT s.pos, e.* FROM stream_entries s JOIN events e ON e.id = s.event_id
         WHERE s.stream = ? AND s.pos >= ? AND s.pos < ? ORDER BY s.pos`,
      )
        .all(streamId, fromPos, toPos)
        .map(row => ({ pos: integer(row, 'pos'), event: eventFromRow(row) })),

    findEntries: async eventId =>
      prepare('SELECT stream, pos FROM stream_entries WHERE event_id = ? ORDER BY stream').all(eventId).map(row => ({ stream: stream(row, 'stream'), pos: integer(row, 'pos') })),

    streamLength: async streamId => streamLength(streamId),

    listStreams: async () =>
      prepare('SELECT stream, MAX(pos) + 1 AS length FROM stream_entries GROUP BY stream ORDER BY stream')
        .all()
        .map(row => ({ stream: stream(row, 'stream'), length: integer(row, 'length') })),

    conversationProject: async conversationId => {
      const row = prepare('SELECT project_id FROM events WHERE conversation_id = ? ORDER BY id LIMIT 1').get(conversationId)
      return row ? nullableText(row, 'project_id') : undefined
    },

    getNodes: async (streamId, addresses) =>
      addresses.flatMap(address => {
        const node = getNode(streamId, address)
        return node ? [node] : []
      }),

    listNodes: async (streamId, level, fromIdx, toIdx) =>
      prepare('SELECT * FROM nodes WHERE stream = ? AND level = ? AND idx >= ? AND idx < ? ORDER BY idx').all(streamId, level, fromIdx, toIdx).map(nodeFromRow),

    saveNode: async node =>
      Number(
        prepare(
          `INSERT INTO nodes (stream, level, idx, text, bytes, event_id, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        ).run(node.stream, node.address.level, node.address.idx, node.text, node.bytes, node.eventId, node.model, node.createdAt).changes,
      ) === 1,

    findLeafByEvent: async eventId => {
      const row = prepare('SELECT * FROM nodes WHERE event_id = ? AND level = 0 LIMIT 1').get(eventId)
      return row ? nodeFromRow(row) : undefined
    },

    listMissingLeaves: async (streamId, fromPos) =>
      prepare(
        `SELECT s.pos FROM stream_entries s
         LEFT JOIN nodes n ON n.stream = s.stream AND n.level = 0 AND n.idx = s.pos
         WHERE s.stream = ? AND s.pos >= ? AND n.idx IS NULL ORDER BY s.pos`,
      )
        .all(streamId, fromPos)
        .map(row => integer(row, 'pos')),

    listBuildableParents: async streamId =>
      prepare(
        `SELECT a.level + 1 AS level, a.idx / 2 AS idx FROM nodes a
         JOIN nodes b ON b.stream = a.stream AND b.level = a.level AND b.idx = a.idx + 1
         LEFT JOIN nodes p ON p.stream = a.stream AND p.level = a.level + 1 AND p.idx = a.idx / 2
         WHERE a.stream = ? AND a.idx % 2 = 0 AND p.idx IS NULL ORDER BY level, idx`,
      )
        .all(streamId)
        .map(row => ({ level: integer(row, 'level'), idx: integer(row, 'idx') })),

    getView: async streamId => getView(streamId),

    commitView: async (view, expectedVersion) =>
      transaction('IMMEDIATE', () => {
        const values = [view.throughPos, JSON.stringify(view.nodes.map(node => [node.level, node.idx])), view.rendered, view.bytes, view.version, view.mergePending ? 1 : 0]
        const changes =
          expectedVersion === 0
            ? prepare(
                `INSERT INTO views (stream, through_pos, nodes, rendered, bytes, version, merge_pending) VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(stream) DO NOTHING`,
              ).run(view.stream, ...values).changes
            : prepare(
                `UPDATE views SET through_pos = ?, nodes = ?, rendered = ?, bytes = ?, version = ?, merge_pending = ?
                 WHERE stream = ? AND version = ?`,
              ).run(...values, view.stream, expectedVersion).changes
        if (Number(changes) !== 1) return false
        prepare('INSERT INTO cursors (name, stream, pos) VALUES (?, ?, ?) ON CONFLICT(name, stream) DO UPDATE SET pos = excluded.pos').run('leaf', view.stream, view.throughPos)
        return true
      }),

    readSnapshot: async streamId => transaction('DEFERRED', () => ({ view: getView(streamId), length: streamLength(streamId) })),
  }

  const ftsCursor = (): number => {
    const row = prepare('SELECT pos FROM cursors WHERE name = ? AND stream = ?').get('fts', ftsCursorStream)
    return row ? integer(row, 'pos') : 0
  }

  const search: MemorySearch = {
    indexPending: async request =>
      transaction('IMMEDIATE', () => {
        const rows = prepare('SELECT id, text FROM events WHERE id > ? ORDER BY id LIMIT ?').all(ftsCursor(), request.limit)
        const insert = prepare('INSERT INTO events_fts (rowid, text) VALUES (CAST(? AS INTEGER), ?)')
        for (const row of rows) insert.run(integer(row, 'id'), text(row, 'text'))
        const last = rows.at(-1)
        const cursor = last ? integer(last, 'id') : ftsCursor()
        if (last) prepare('INSERT INTO cursors (name, stream, pos) VALUES (?, ?, ?) ON CONFLICT(name, stream) DO UPDATE SET pos = excluded.pos').run('fts', ftsCursorStream, cursor)
        return { indexed: rows.length, cursor }
      }),

    search: async request => {
      const match = ftsQuery(request.query)
      if (match === '') return []
      // Rank first, snippet only the survivors: snippet() over every match costs ~0.1 ms per row.
      const ranked =
        request.stream === null
          ? prepare('SELECT rowid AS id FROM events_fts WHERE events_fts MATCH ? ORDER BY bm25(events_fts), rowid DESC LIMIT ?').all(match, request.limit)
          : prepare(
              `SELECT id FROM (SELECT rowid AS id, bm25(events_fts) AS score FROM events_fts WHERE events_fts MATCH ?) hits
               WHERE EXISTS (SELECT 1 FROM stream_entries s WHERE s.event_id = hits.id AND s.stream = ?)
               ORDER BY score, id DESC LIMIT ?`,
            ).all(match, request.stream, request.limit)
      return ranked.flatMap(rankedRow => {
        const eventId = integer(rankedRow, 'id')
        // node:sqlite binds JS numbers as REAL, which an FTS5 rowid constraint silently ignores.
        const snippetRow = prepare(`SELECT snippet(events_fts, 0, '[', ']', '…', ${snippetTokens}) AS snippet FROM events_fts WHERE events_fts MATCH ? AND rowid = CAST(? AS INTEGER)`).get(match, eventId)
        const row = prepare('SELECT id, conversation_id, project_id, role, created_at FROM events WHERE id = ?').get(eventId)
        if (!row) return []
        const hit: StoredSearchHit = {
          eventId,
          conversationId: text(row, 'conversation_id'),
          projectId: nullableText(row, 'project_id'),
          role: role(row),
          createdAt: integer(row, 'created_at'),
          snippet: snippetRow ? text(snippetRow, 'snippet') : '',
          entries: prepare('SELECT stream, pos FROM stream_entries WHERE event_id = ? ORDER BY stream')
            .all(eventId)
            .map(entry => ({ stream: stream(entry, 'stream'), pos: integer(entry, 'pos') })),
        }
        return [hit]
      })
    },

    status: async () => {
      const cursor = ftsCursor()
      const lag = integer(prepare('SELECT COUNT(*) AS lag FROM events WHERE id > ?').get(cursor) ?? { lag: 0 }, 'lag')
      return { cursor, lag }
    },
  }

  return {
    store,
    search,
    database,
    close: () => {
      if (database.isOpen) database.close()
    },
  }
}
