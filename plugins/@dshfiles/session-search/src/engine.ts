/**
 * The `sessionQuery` search backend. It extends core's exported read engine — so every inherited read (list, read,
 * titles, filters, traces, observations) stays core's own code — and implements only the two search operations, which
 * forward to the worker that owns the index. No decode, parse, or SQLite work runs here.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import { decodeJsonSafe } from '@dshfiles/dshx/json'
import {
  assertSessionHeadersCompatible,
  materializeSessionEventResultFilters,
  readColdSessionLog,
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
  type SessionLogSnapshot,
  type SessionRecord,
  type SessionTitleObservationResult,
} from '@deepseek-ai/dsh-session-query'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'
import { withoutUndefined } from './optional-fields.js'
import type { EventFilters, SearchMatch, SessionHeaderRow } from './protocol.js'
import { readLiveTitle, readBoundedTitle, type BoundedTitleSnapshot } from './title-read.js'
import { SearchWorkerPort } from './worker-port-promise.js'

/** Bounds how stale a listing may get when another process writes the same Session logs. */
const LISTING_TTL_MS = 60_000

/** A config the Host row may omit: every count falls back to the value this backend has always run with. */
const positiveCount = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const nonNegativeCount = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const engineConfigSchema = Schema.Struct({
  client: Schema.instanceOf(SearchWorkerPort),
  defaultLimit: positiveCount.pipe(Schema.withDecodingDefault(Effect.succeed(20))),
  maxLimit: positiveCount.pipe(Schema.withDecodingDefault(Effect.succeed(100))),
  readWindowMax: nonNegativeCount.pipe(Schema.withDecodingDefault(Effect.succeed(50))),
  persistedReadConcurrency: positiveCount.pipe(Schema.withDecodingDefault(Effect.succeed(4))),
  preparedSessionCacheSize: positiveCount.pipe(Schema.withDecodingDefault(Effect.succeed(5))),
})
export type SessionSearchEngineConfig = typeof engineConfigSchema.Encoded

const cursorPayloadSchema = Schema.Struct({
  version: Schema.Literal(1),
  scope: Schema.Literals(['sessions', 'events']),
  fingerprint: Schema.String,
  offset: nonNegativeCount,
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

const sessionNotFound = (sessionId: SessionId): SessionQueryError =>
  new SessionQueryError(`session "${sessionId}" not found`, 'SESSION_QUERY_SESSION_NOT_FOUND')

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const unsupportedFilters = (label: string): never => {
  throw new SessionQueryError(`the owned session-search backend does not implement ${label} yet`, 'SESSION_QUERY_INVALID_FILTER')
}

export class SessionSearchEngine extends SessionQueryEngine {
  readonly _client: SearchWorkerPort
  readonly _defaultLimit: number
  readonly _maxLimit: number

  constructor(ctx: Context, config: SessionSearchEngineConfig) {
    const parsed = Schema.decodeUnknownSync(engineConfigSchema)(config)
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
      if (this._listing !== undefined && this._listing.headers.get(session.id) !== JSON.stringify(session.header)) this._listing = undefined
    })
    ctx.on('session/created', () => {
      this._listing = undefined
    })
    ctx.on('session/disposed', () => {
      this._listing = undefined
    })
  }

  /**
   * Core lists Sessions by reading the first frame of every log (971 here): 10 s on a cold disk right after a restart,
   * ~0.3 s warm, and the Session list, Memory's finder and other plugins each list on their own. One listing serves them
   * until a Session is created or disposed, a listed live Session's header changes (a workspace move), or a minute
   * passes, which bounds what another process writing the same logs can leave stale.
   */
  _listing: { readonly value: Promise<SessionRecord[]>; readonly at: number; readonly headers: Map<string, string> } | undefined

  override async listSessions(signal?: AbortSignal): Promise<SessionRecord[]> {
    const listing = this._listing
    if (listing === undefined || Date.now() - listing.at >= LISTING_TTL_MS) {
      const headers = new Map<string, string>()
      const value = super.listSessions(signal).then(records => {
        for (const record of records) headers.set(record.header.id, JSON.stringify(record.header))
        return records
      })
      const entry = { value, at: Date.now(), headers }
      this._listing = entry
      value.catch(() => {
        if (this._listing === entry) this._listing = undefined
      })
      return structuredClone(await value)
    }
    return structuredClone(await listing.value)
  }

  /**
   * Core's `readSession` resolves a stored Session by listing the whole corpus (2,900 logs here) before reading the one
   * it wants, and Memory, pull requests and the review panel each read Sessions that way. Core's own `readSession` body
   * still runs — it owns the replay validation and the message projections it validates with — but against a corpus of
   * this one Session, resolved by `stat` and one read handle instead of a listing. Results and error codes match core's.
   */
  override async readSession(sessionId: SessionId): Promise<SessionLogSnapshot> {
    return SessionQueryEngine.prototype.readSession.call({ _corpus: { load: (id: SessionId) => this._loadOne(id) } }, sessionId)
  }

  /** Core's live-preferred `SessionCorpus.load` for one id, with `stat` in place of the corpus listing. */
  async _loadOne(sessionId: SessionId): Promise<Omit<SessionLogSnapshot, 'session'> & { header: SessionHeader }> {
    const live = () => {
      const session = this.ctx.sessions.get(sessionId)
      if (session === undefined) return undefined
      return {
        header: structuredClone(session.header),
        inheritedEventCount: session.inheritedEventCount,
        events: session.snapshotEvents().map(event => structuredClone(event)),
      }
    }
    const attached = live()
    if (attached !== undefined) return attached
    const persistence = this.ctx.get('sessionPersistence')
    if (persistence === undefined) throw sessionNotFound(sessionId)
    const stored = await persistence.stat(sessionId).catch((error: unknown) => {
      throw new SessionQueryError(`session persistence lookup failed: ${errorText(error)}`, 'SESSION_QUERY_PERSISTENCE_FAILED', { cause: error })
    })
    if (stored === undefined) throw sessionNotFound(sessionId)
    const loaded = await readColdSessionLog(persistence, sessionId).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'SessionPersistenceCorruptionError')
        throw new SessionQueryError(`stored session "${sessionId}" is corrupt: ${errorText(error)}`, 'SESSION_QUERY_CORRUPT_SESSION', { cause: error })
      throw new SessionQueryError(`failed to read stored session "${sessionId}": ${errorText(error)}`, 'SESSION_QUERY_PERSISTENCE_FAILED', { cause: error })
    })
    const attachedMeanwhile = live()
    if (attachedMeanwhile !== undefined) return attachedMeanwhile
    assertSessionHeadersCompatible(loaded.header, stored.header)
    return {
      header: structuredClone(loaded.header),
      inheritedEventCount: loaded.inheritedEventCount,
      events: loaded.events.map(event => structuredClone(event)),
    }
  }

  /**
   * Core folds a title by decoding the Session's whole log (86 MB for the largest here), four at a time, and Memory's
   * finder and the worktree-memory panel ask for dozens of titles per search or 3 s poll. A title read therefore takes
   * a bounded path first — a live Session's own events, else the first and last bytes of its log plus the projection
   * checkpoint — and only a log no bounded read can prove reads whole. A title changes only through an event appended
   * to its own Session, so a read title is kept until then.
   */
  readonly _titles = new Map<string, SessionTitleObservationResult>()

  /** How many titles one batch reads at once: each cold read holds a window of one log, not the log. */
  readonly _titleReadConcurrency = 4

  override async readTitleSnapshots(sessionIds: readonly SessionId[], signal?: AbortSignal): Promise<SessionTitleObservationResult[]> {
    const missing = [...new Set(sessionIds)].filter(id => !this._titles.has(id))
    const read = new Map<string, SessionTitleObservationResult>()
    const unresolved: SessionId[] = []
    const queue = [...missing]
    const readOne = async (): Promise<void> => {
      for (;;) {
        const id = queue.shift()
        if (id === undefined) return
        signal?.throwIfAborted()
        const bounded = await this._boundedTitle(id, signal)
        if (bounded === undefined) unresolved.push(id)
        else read.set(id, bounded)
      }
    }
    await Promise.all(Array.from({ length: Math.min(this._titleReadConcurrency, missing.length) }, readOne))
    if (unresolved.length > 0) {
      // One corpus observation serves every log no window could prove, and it owns its own failure taxonomy.
      for (const result of await super.readTitleSnapshots(unresolved, signal)) read.set(result.sessionId, result)
    }
    for (const result of read.values()) if (result.status === 'fulfilled') this._titles.set(result.sessionId, result)
    return sessionIds.flatMap(id => {
      const result = this._titles.get(id) ?? read.get(id)
      return result === undefined ? [] : [structuredClone(result)]
    })
  }

  /** One bounded title read, or `undefined` when only core's whole-log fold can answer exactly. */
  async _boundedTitle(id: SessionId, signal: AbortSignal | undefined): Promise<SessionTitleObservationResult | undefined> {
    const abort = signal ?? new AbortController().signal
    try {
      const live = this.ctx.sessions.get(id)
      const value: BoundedTitleSnapshot | undefined =
        live === undefined ? await readBoundedTitle({ ctx: this.ctx, sessionId: id, signal: abort }) : readLiveTitle(live)
      return value === undefined ? undefined : { sessionId: id, status: 'fulfilled', value }
    } catch (error) {
      if (abort.aborted) throw error
      // A failed window sends the caller to the full read, whose own path reports the failure in the query taxonomy.
      return undefined
    }
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

  _parseCursor(cursor: string): typeof cursorPayloadSchema.Type | undefined {
    try {
      const parsed = decodeJsonSafe(cursorPayloadSchema, Buffer.from(cursor, 'base64url').toString('utf8'))
      return parsed._tag === 'Success' ? parsed.success : undefined
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
