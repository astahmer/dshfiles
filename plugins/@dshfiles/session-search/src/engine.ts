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
  SessionQueryEngine,
  SessionQueryError,
  SessionSearchCursor,
  type SessionEventSearchHit,
  type SessionEventSearchPage,
  type SessionEventSearchRequest,
  type SessionSearchExecContext,
  type SessionSearchHit,
  type SessionSearchPage,
  type SessionSearchRequest,
} from '@deepseek-ai/dsh-session-query'
import { z } from 'zod'
import { withoutUndefined } from './optional-fields.js'
import type { SearchMatch, SessionHeaderRow } from './protocol.js'
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

const cursorPayloadSchema = z.object({ version: z.literal(1), scope: z.enum(['sessions', 'events']), fingerprint: z.string(), offset: z.number().int().nonnegative() })

type CursorFingerprint =
  | { readonly scope: 'sessions'; readonly query: string; readonly limit: number }
  | { readonly scope: 'events'; readonly sessionId: string; readonly query: string; readonly limit: number }

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
  }

  override async searchSessions(request: SessionSearchRequest, exec?: SessionSearchExecContext): Promise<SessionSearchPage<SessionSearchHit>> {
    if (request.sessionFilters !== undefined && request.sessionFilters.length > 0) unsupportedFilters('session filters')
    if (request.eventFilters !== undefined && request.eventFilters.length > 0) unsupportedFilters('event filters')
    const query = request.query
    const limit = Math.min(this._maxLimit, Math.max(1, request.limit ?? this._defaultLimit))
    const fingerprint = this._fingerprint({ scope: 'sessions', query, limit })
    const offset = this._decodeCursor(request.cursor, 'sessions', fingerprint)
    exec?.signal?.throwIfAborted()
    const page = await this._client.searchSessions(withoutUndefined({ query, limit, cursor: offset === 0 ? undefined : offset }))
    exec?.signal?.throwIfAborted()
    return withoutUndefined({
      items: page.matches.map(match => this._sessionHit(match)),
      nextCursor: page.hasMore ? this._encodeCursor('sessions', fingerprint, offset + limit) : undefined,
    })
  }

  override async searchEvents(request: SessionEventSearchRequest, exec?: SessionSearchExecContext): Promise<SessionEventSearchPage> {
    if (request.filters !== undefined && request.filters.length > 0) unsupportedFilters('event filters')
    const query = request.query
    const limit = Math.min(this._maxLimit, Math.max(1, request.limit ?? this._defaultLimit))
    const fingerprint = this._fingerprint({ scope: 'events', sessionId: request.sessionId, query, limit })
    const offset = this._decodeCursor(request.cursor, 'events', fingerprint)
    exec?.signal?.throwIfAborted()
    const page = await this._client.searchEvents(withoutUndefined({ sessionId: request.sessionId, query, limit, cursor: offset === 0 ? undefined : offset }))
    exec?.signal?.throwIfAborted()
    if (page.header === null) throw new SessionQueryError(`stored session "${request.sessionId}" is not in the search index`, 'SESSION_QUERY_SESSION_NOT_FOUND')
    return withoutUndefined({
      session: toHeader(page.header),
      items: page.matches.map(match => this._eventHit(match)),
      nextCursor: page.hasMore ? this._encodeCursor('events', fingerprint, offset + limit) : undefined,
    })
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
