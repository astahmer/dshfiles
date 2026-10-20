/**
 * The `sessionQuery` search backend. It extends core's exported read engine — so every inherited read (list, read,
 * titles, filters, traces, observations) stays core's own code — and implements only the two search operations, which
 * forward to the worker that owns the index. No decode, parse, or SQLite work runs here.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import {
  materializeSessionEventResultFilters,
  SessionQueryEngine,
  SessionQueryError,
  SessionSearchCursor,
  type SessionResultFilter,
  type SessionEventResultFilter,
  type SessionEventSearchHit,
  type SessionEventSearchPage,
  type SessionEventSearchRequest,
  type SessionSearchExecContext,
  type SessionSearchHit,
  type SessionSearchPage,
  type SessionSearchRequest,
  type SessionTitleObservationResult,
} from '@deepseek-ai/dsh-session-query'
import { z } from 'zod'
import { withoutUndefined } from './optional-fields.js'
import type { EventFilters, SearchMatch, SessionHeaderRow } from './protocol.js'
import { SearchWorkerClient } from './worker-client.js'

const engineConfigSchema = z.object({
  client: z.custom<SearchWorkerClient>(value => value instanceof SearchWorkerClient, 'a session-search worker client'),
  defaultLimit: z.number().int().positive().default(20),
  maxLimit: z.number().int().positive().default(100),
  readWindowMax: z.number().int().nonnegative().default(50),
  persistedReadConcurrency: z.number().int().positive().default(4),
  preparedSessionCacheSize: z.number().int().positive().default(5),
})
export type SessionSearchEngineConfig = z.input<typeof engineConfigSchema>

const cursorPayloadSchema = z.object({
  version: z.literal(1),
  scope: z.enum(['sessions', 'events']),
  fingerprint: z.string(),
  offset: z.number().int().nonnegative(),
})

type CursorFingerprint =
  | {
      readonly scope: 'sessions'
      readonly query: string
      readonly limit: number
      readonly sessionIds?: readonly string[]
      readonly filters?: EventFilters
    }
  | { readonly scope: 'events'; readonly sessionId: string; readonly query: string; readonly limit: number; readonly filters?: EventFilters }

const toHeader = (row: SessionHeaderRow): SessionHeader =>
  withoutUndefined({
    version: SESSION_FORMAT_VERSION,
    id: SessionId(row.id),
    createdAt: row.createdAt,
    cwd: row.cwd,
    parentSession: row.parentSession === undefined ? undefined : SessionId(row.parentSession),
    isSeeded: row.isSeeded,
    delegationDepth: row.delegationDepth,
    agentPreset: row.agentPreset,
  })

const unsupportedFilters = (label: string): never => {
  throw new SessionQueryError(`the owned session-search backend does not implement ${label} yet`, 'SESSION_QUERY_INVALID_FILTER')
}

export class SessionSearchEngine extends SessionQueryEngine {
  readonly _client: SearchWorkerClient
  readonly _defaultLimit: number
  readonly _maxLimit: number

  constructor(ctx: Context, config: SessionSearchEngineConfig) {
    const parsed = engineConfigSchema.parse(config)
    super(ctx, {
      readWindowMax: parsed.readWindowMax,
      persistedReadConcurrency: parsed.persistedReadConcurrency,
      preparedSessionCacheSize: parsed.preparedSessionCacheSize,
    })
    this._client = parsed.client
    this._defaultLimit = parsed.defaultLimit
    this._maxLimit = parsed.maxLimit
    ctx.on('session/event', session => {
      this._titles.delete(session.id)
    })
  }

  /**
   * Core folds a title by decoding the Session's whole log (69 MB compressed for the largest here), and Memory's
   * finder and the worktree-memory panel ask for dozens of titles per search or 3 s poll. A title changes only through
   * an event appended to its own Session, so a read title is kept until then.
   */
  readonly _titles = new Map<string, SessionTitleObservationResult>()

  override async readTitleSnapshots(sessionIds: readonly SessionId[], signal?: AbortSignal): Promise<SessionTitleObservationResult[]> {
    const missing = sessionIds.filter(id => !this._titles.has(id))
    const read = new Map((missing.length === 0 ? [] : await super.readTitleSnapshots(missing, signal)).map(result => [result.sessionId, result]))
    for (const result of read.values()) if (result.status === 'fulfilled') this._titles.set(result.sessionId, result)
    return sessionIds.flatMap(id => {
      const result = this._titles.get(id) ?? read.get(id)
      return result === undefined ? [] : [structuredClone(result)]
    })
  }

  override async searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>> {
    const query = request.query
    const limit = Math.min(this._maxLimit, Math.max(1, request.limit ?? this._defaultLimit))
    const sessionIds = this._sessionIds(request.sessionFilters)
    const filters = this._eventFilters(request.eventFilters)
    const fingerprint = this._fingerprint(withoutUndefined({ scope: 'sessions', query, limit, sessionIds, filters }))
    const offset = this._decodeCursor(request.cursor, 'sessions', fingerprint)
    exec?.signal?.throwIfAborted()
    // An id filter that matches nothing must answer empty, never fall back to the whole corpus.
    if (sessionIds !== undefined && sessionIds.length === 0) return { items: [] }
    const page = await this._client.searchSessions(
      withoutUndefined({
        query,
        limit,
        cursor: offset === 0 ? undefined : offset,
        sessionIds: sessionIds === undefined || sessionIds.length === 0 ? undefined : sessionIds,
        filters,
      }),
    )
    exec?.signal?.throwIfAborted()
    return withoutUndefined({
      items: page.matches.map(match => this._sessionHit(match)),
      nextCursor: page.hasMore ? this._encodeCursor('sessions', fingerprint, offset + limit) : undefined,
    })
  }

  override async searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage> {
    const query = request.query
    const limit = Math.min(this._maxLimit, Math.max(1, request.limit ?? this._defaultLimit))
    const filters = this._eventFilters(request.filters)
    const fingerprint = this._fingerprint(withoutUndefined({ scope: 'events', sessionId: request.sessionId, query, limit, filters }))
    const offset = this._decodeCursor(request.cursor, 'events', fingerprint)
    exec?.signal?.throwIfAborted()
    const page = await this._client.searchEvents(
      withoutUndefined({ sessionId: request.sessionId, query, limit, cursor: offset === 0 ? undefined : offset, filters }),
    )
    exec?.signal?.throwIfAborted()
    if (page.header === null) throw new SessionQueryError(`stored session "${request.sessionId}" is not in the search index`, 'SESSION_QUERY_SESSION_NOT_FOUND')
    return withoutUndefined({
      session: toHeader(page.header),
      items: page.matches.map(match => this._eventHit(match)),
      nextCursor: page.hasMore ? this._encodeCursor('events', fingerprint, offset + limit) : undefined,
    })
  }

  /**
   * Core validates and copies the clauses, then they map one-to-one onto SQL predicates. `text` is a literal scan over
   * untruncated documents, which no FTS5 index can serve, so it stays refused instead of silently ignored.
   */
  _eventFilters(filters: readonly SessionEventResultFilter[] | undefined): EventFilters | undefined {
    if (filters === undefined || filters.length === 0) return undefined
    const mapped = materializeSessionEventResultFilters(filters).map(filter => {
      switch (filter.kind) {
        case 'type':
          return { kind: 'type' as const, values: filter.values.map(value => String(value)) }
        case 'surface':
          return { kind: 'surface' as const, values: filter.values.map(value => String(value)) }
        case 'seq':
          return withoutUndefined({ kind: 'seq' as const, from: filter.from, to: filter.to })
        case 'time':
          return withoutUndefined({ kind: 'time' as const, from: filter.from, to: filter.to })
        case 'text':
          return unsupportedFilters('literal text event filters')
      }
    })
    return mapped.length === 0 ? undefined : mapped
  }

  /** Translate the `id` clause the callers use; every other session filter stays refused rather than ignored. */
  _sessionIds(filters: readonly SessionResultFilter[] | undefined): readonly string[] | undefined {
    if (filters === undefined || filters.length === 0) return undefined
    let ids: readonly string[] | undefined
    for (const filter of filters) {
      if (filter.kind === 'id') {
        const values = filter.values.map(value => String(value))
        ids = ids === undefined ? values : ids.filter(id => values.includes(id))
        continue
      }
      unsupportedFilters(`${filter.kind} session filters`)
    }
    return ids
  }

  _sessionHit(match: SearchMatch): SessionSearchHit {
    return {
      header: toHeader(match.header),
      live: this.ctx.sessions.get(SessionId(match.sessionId)) !== undefined,
      persisted: true,
      bestMatch: this._eventHit(match),
    }
  }

  _eventHit(match: SearchMatch): SessionEventSearchHit {
    return {
      sessionId: SessionId(match.sessionId),
      seq: SessionSeq(match.seq),
      // SAFETY: the worker indexed this value from core's own event extractor, so it is a SessionEventType member.
      type: match.type as SessionEventSearchHit['type'],
      time: match.time,
      // SAFETY: the surface comes from core's own surface folding, so it is a SessionEventSurface member.
      surface: match.surface as SessionEventSearchHit['surface'],
      snippet: match.snippet,
    }
  }

  _fingerprint(payload: CursorFingerprint): string {
    return JSON.stringify(payload)
  }

  _parseCursor(cursor: string): z.infer<typeof cursorPayloadSchema> | undefined {
    try {
      const parsed = cursorPayloadSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  _decodeCursor(cursor: string | undefined, scope: 'sessions' | 'events', fingerprint: string): number {
    if (cursor === undefined) return 0
    const payload = this._parseCursor(cursor)
    if (payload === undefined) throw new SessionQueryError('the search cursor is not readable', 'SESSION_QUERY_INVALID_CURSOR')
    if (payload.scope !== scope) throw new SessionQueryError('the search cursor does not belong to this request', 'SESSION_QUERY_INVALID_CURSOR')
    if (payload.fingerprint !== fingerprint) throw new SessionQueryError('the corpus changed since this cursor was issued', 'SESSION_QUERY_STALE_CURSOR')
    return payload.offset
  }

  _encodeCursor(scope: 'sessions' | 'events', fingerprint: string, offset: number): ReturnType<typeof SessionSearchCursor> {
    return SessionSearchCursor(Buffer.from(JSON.stringify({ version: 1, scope, fingerprint, offset }), 'utf8').toString('base64url'))
  }
}
