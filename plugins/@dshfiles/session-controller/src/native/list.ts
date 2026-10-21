/** Cold-safe Session list and search projection. */

import { performance } from 'node:perf_hooks'
import { scheduler } from 'node:timers/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import type { Session, SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionSnapshot, SessionProjectionMap } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import { SessionQueryError, type SessionRecord, type SessionSearchCursor } from '@deepseek-ai/dsh-session-query'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import {
  SESSION_SEARCH_RESULT_LIMIT,
  SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS,
} from './types.ts'
import type {
  SessionListMetadata, SessionListRequest, SessionProjectionHints, SessionProjectionValues,
  SessionSearchItem, SessionSearchValue, SessionSummary,
} from './types.ts'

const SEARCH_PROVIDER_CALL_LIMIT = 100
const SESSION_SEARCH_QUERY_MAX_CHARS = 500
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])
const LIST_METADATA_KEY = 'sessionListMetadata'

/** A caller's projection allowlist; `undefined` reads every registered column. */
type ProjectionSelection = ReadonlySet<string> | undefined

/** Projection columns read for one row, split into the caller's values and the row's own metadata. */
interface ProjectionRead {
  readonly projections?: SessionProjectionHints
  readonly metadata?: SessionListMetadata
}

const sessionListMetadataSchema: z.ZodType<SessionListMetadata> = z.object({
  blank: z.boolean(),
  lastPromptAt: z.number().nullable(),
})

const imageLimitsSchema = z.object({
  maxImageBytes: z.number().int().positive(),
  maxImagesPerMessage: z.number().int().positive(),
  maxMessageImageBytes: z.number().int().positive(),
  maxImagePixels: z.number().int().positive(),
  maxImageDimension: z.number().int().positive(),
  mediaTypes: z.array(z.string()),
}) as unknown as z.ZodType<ImageAttachmentLimits>

/**
 * Advance the Session-list metadata projection by one committed event.
 * @param state - metadata before the event.
 * @param event - next committed Session event.
 * @returns the original or advanced metadata value.
 */
export function applySessionListMetadata(
  state: SessionListMetadata,
  event: SessionEvent,
): SessionListMetadata {
  const blank = state.blank && event.type !== 'turn/start'
  const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
    ? event.time
    : state.lastPromptAt
  return blank === state.blank && lastPromptAt === state.lastPromptAt
    ? state
    : { blank, lastPromptAt }
}

/**
 * Return the longest prefix containing at most `maximum` Unicode code points.
 * @param value - source text.
 * @param maximum - maximum number of Unicode code points.
 * @returns the source text or its longest allowed prefix.
 */
export function truncateUnicodeCodePoints(value: string, maximum: number): string {
  let count = 0
  let end = 0
  for (const codePoint of value) {
    if (count === maximum) return value.slice(0, end)
    count++
    end += codePoint.length
  }
  return value
}

/** Owns list projection registration, bounded cold summaries, and authorized search. */
export class ApiSessionList {
  /**
   * Projection columns of cold rows by Session id. Each one reads the Session log's compressed prefix from disk, once
   * per cold Session on every list call (1.4 s of Host CPU per minute on a 944-Session corpus). A cold log changes only
   * while its Session is attached here, so an entry is dropped when the Session attaches, appends or detaches.
   */
  private readonly coldProjections = new Map<string, SessionProjectionHints>()

  /**
   * Persisted Session records, read once and kept until this Host creates or disposes a Session.
   * `sessionQuery.listSessions` re-enumerates every project directory and then reads each Session's header and stats
   * its log at a concurrency of three, so a 1 000-Session corpus costs thousands of filesystem round-trips per call
   * (Host gap 71). Those headers never change after the Session is written, and every list field comes from the header
   * or the projection cache, which keeps its own invalidation.
   */
  private persisted: readonly SessionRecord[] | undefined

  /** The read every caller waits on, so concurrent lists fold one corpus instead of one each. */
  private persistedRead: Promise<readonly SessionRecord[]> | undefined

  /** Bumped on every invalidation so a read that started earlier cannot cache a corpus it predates. */
  private persistedGeneration = 0

  private readonly lifetime = new AbortController()

  /**
   * @param ctx - Host context carrying Session, query, persistence, and projection services.
   * @param workSliceMs - Resolved positive integral list-work budget in milliseconds.
   */
  constructor(private readonly ctx: Context, private readonly workSliceMs: number) {
    const forgetProjections = (session: Session): void => { this.coldProjections.delete(session.id) }
    const forgetSession = (session: Session): void => {
      forgetProjections(session)
      this.invalidatePersisted()
    }
    ctx.on('session/created', forgetSession)
    ctx.on('session/event', forgetProjections)
    ctx.on('session/disposed', forgetSession)
    ctx.effect(() => () => { this.lifetime.abort() }, 'session-controller.list: stop a background corpus read')
    ctx.sessionProjections.register<'sessionListMetadata', SessionListMetadata>({
      key: 'sessionListMetadata',
      stateSchema: sessionListMetadataSchema,
      init: () => ({ blank: true, lastPromptAt: null }),
      apply: applySessionListMetadata,
      wire: { viewSchema: sessionListMetadataSchema, view: state => state },
      stateVersion: 1,
    })
    ctx.inject(['attachments'], (attachmentCtx) => {
      ctx.sessionProjections.register<'imageLimits', null>({
        key: 'imageLimits',
        stateSchema: z.null(),
        init: () => null,
        apply: state => state,
        wire: {
          viewSchema: imageLimitsSchema,
          view: () => attachmentCtx.attachments.imageLimits,
        },
        stateVersion: 1,
      })
    })
  }

  /**
   * Build one current attached-Session summary.
   * @param session - attached Session to summarize.
   * @returns current list metadata and available projections.
   */
  summaryFor(session: Session, selection?: ProjectionSelection): SessionSummary {
    const read = this.projectionsFor(session.header, session, selection)
    const metadata = read.metadata
    return {
      sessionId: session.id,
      updatedAt: updatedAt(session.header, metadata),
      agentAvailable: this.ctx.agents.get(session.id)?.session === session,
      formatStatus: 'current',
      running: this.ctx.agents.get(session.id)?.status === 'running',
      blank: metadata?.blank ?? session.seq === 0,
      ...listFields(session.header),
      ...(read.projections === undefined ? {} : { projections: read.projections }),
    }
  }

  /**
   * Read every visible attached and persisted Session without activating an Agent.
   * @param request - optional projection allowlist; omitted reads every column.
   * @param signal - optional cancellation for persistence reads and summary generation.
   * @returns visible Session summaries ordered by activity.
   */
  async list(request: SessionListRequest = {}, signal?: AbortSignal): Promise<SessionSummary[]> {
    const selection = projectionSelectionOf(request.projections)
    signal?.throwIfAborted()
    const records = await this.persistedSessions(signal)
    signal?.throwIfAborted()
    const items: SessionSummary[] = []
    const cold: SessionRecord[] = []
    let yieldDeadline = performance.now() + this.workSliceMs
    for (const record of records) {
      signal?.throwIfAborted()
      const live = this.ctx.sessions.get(record.header.id)
      if (live !== undefined) {
        items.push(this.summaryFor(live, selection))
      } else if (record.header.cwd !== undefined) {
        cold.push(record)
      }
      if (performance.now() >= yieldDeadline) {
        await scheduler.yield()
        signal?.throwIfAborted()
        yieldDeadline = performance.now() + this.workSliceMs
      }
    }
    for (const record of cold) {
      signal?.throwIfAborted()
      items.push(this.summarizeCold(record, selection))
      if (performance.now() >= yieldDeadline) {
        await scheduler.yield()
        signal?.throwIfAborted()
        yieldDeadline = performance.now() + this.workSliceMs
      }
    }
    signal?.throwIfAborted()
    items.sort((left, right) => right.updatedAt - left.updatedAt)
    return items
  }

  /**
   * Fold one corpus read for every caller, and honour a caller's own budget while the read runs.
   * @param signal - caller's cancellation, which stops this caller waiting but not the shared read.
   * @returns the persisted Session records.
   */
  private async persistedSessions(signal: AbortSignal | undefined): Promise<readonly SessionRecord[]> {
    signal?.throwIfAborted()
    const persisted = this.persisted
    if (persisted !== undefined) return persisted
    const read = this.persistedRead ?? this.startPersistedRead()
    return signal === undefined ? read : abortable(read, signal)
  }

  private startPersistedRead(): Promise<readonly SessionRecord[]> {
    const generation = this.persistedGeneration
    const read = this.ctx.sessionQuery.listSessions(this.lifetime.signal).then(records => {
      if (this.persistedGeneration === generation) this.persisted = records
      return records
    })
    this.persistedRead = read
    const settle = (): void => {
      if (this.persistedRead === read) this.persistedRead = undefined
    }
    void read.then(settle, settle)
    return read
  }

  private invalidatePersisted(): void {
    this.persisted = undefined
    this.persistedRead = undefined
    this.persistedGeneration += 1
  }

  private summarizeCold({ header, formatStatus }: SessionRecord, selection?: ProjectionSelection): SessionSummary {
    const cached = this.coldProjections.get(header.id)
    const read = cached === undefined
      ? this.projectionsFor(header, undefined, selection)
      : projectionReadOf(cached, selection, cached.values[LIST_METADATA_KEY])
    // Only a full read is memoized: a filtered read must never answer a later full read with missing columns. A miss
    // stays unmemoized so the persisted cache can gain this Session's record later.
    if (cached === undefined && selection === undefined && read.projections !== undefined) {
      this.coldProjections.set(header.id, read.projections)
    }
    const metadata = read.metadata
    return {
      sessionId: header.id,
      updatedAt: updatedAt(header, metadata),
      agentAvailable: false,
      ...(formatStatus === undefined ? {} : { formatStatus }),
      running: false,
      // A large, metadata-less, or inaccessible cache miss remains unknown and visible.
      blank: metadata?.blank ?? false,
      ...listFields(header),
      ...(read.projections === undefined ? {} : { projections: read.projections }),
    }
  }

  /**
   * Search current visible message content without activating any matching Session.
   * @param query - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  async search(query: string, signal: AbortSignal): Promise<SessionSearchValue> {
    const normalizedQuery = normalizeSearchQuery(query)
    signal.throwIfAborted()
    const provider = this.ctx.get('sessionQuery')
    if (provider === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'session search is unavailable: this deployment does not mount @deepseek-ai/dsh-session-query',
        {},
      )
    }
    try {
      const visible = await provider.listSessions(signal)
      signal.throwIfAborted()
      const visibleIds = new Set(visible
        .filter(record => record.header.cwd !== undefined)
        .map(record => record.header.id))
      if (visibleIds.size === 0) return { items: [], hasMore: false }
      const authorized: SessionSearchItem[] = []
      const acceptedIds = new Set<SessionId>()
      const seenCursors = new Set<SessionSearchCursor>()
      let cursor: SessionSearchCursor | undefined
      let providerCalls = 0
      let pageLimit = SESSION_SEARCH_RESULT_LIMIT
      while (authorized.length <= SESSION_SEARCH_RESULT_LIMIT) {
        signal.throwIfAborted()
        if (providerCalls >= SEARCH_PROVIDER_CALL_LIMIT) {
          throw new Error(`session search provider exceeded the ${SEARCH_PROVIDER_CALL_LIMIT}-call work budget`)
        }
        providerCalls++
        const requestedCursor = cursor
        const requestedLimit = pageLimit
        let page
        try {
          page = await provider.searchSessions({
            query: normalizedQuery,
            eventFilters: [
              { kind: 'type', values: ['user/message', 'assistant/message'] },
              { kind: 'surface', values: ['current'] },
            ],
            limit: requestedLimit,
            ...(requestedCursor === undefined ? {} : { cursor: requestedCursor }),
          }, { signal })
          signal.throwIfAborted()
        } catch (error: unknown) {
          signal.throwIfAborted()
          if (requestedCursor === undefined
            && error instanceof SessionQueryError
            && error.code === 'SESSION_QUERY_INVALID_LIMIT'
            && requestedLimit > 1) {
            pageLimit = Math.max(1, Math.floor(requestedLimit / 2))
            continue
          }
          if (requestedCursor !== undefined
            && error instanceof SessionQueryError
            && error.code === 'SESSION_QUERY_STALE_CURSOR') {
            authorized.length = 0
            acceptedIds.clear()
            seenCursors.clear()
            cursor = undefined
            continue
          }
          throw error
        }
        if (page.items.length > requestedLimit) {
          throw new Error(`session search provider returned ${String(page.items.length)} items; maximum is ${String(requestedLimit)}`)
        }
        for (const hit of page.items) {
          if (authorized.length > SESSION_SEARCH_RESULT_LIMIT) continue
          if (!visibleIds.has(hit.header.id)
            || hit.bestMatch.sessionId !== hit.header.id
            || hit.bestMatch.surface !== 'current'
            || !MESSAGE_TYPES.has(hit.bestMatch.type)
            || acceptedIds.has(hit.header.id)) continue
          acceptedIds.add(hit.header.id)
          authorized.push({
            sessionId: hit.header.id,
            snippet: truncateUnicodeCodePoints(hit.bestMatch.snippet, SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS),
          })
        }
        if (page.nextCursor !== undefined) {
          if (seenCursors.has(page.nextCursor)) {
            throw new Error('session search provider repeated a continuation cursor')
          }
          seenCursors.add(page.nextCursor)
        }
        if (authorized.length > SESSION_SEARCH_RESULT_LIMIT || page.nextCursor === undefined) break
        cursor = page.nextCursor
      }
      return {
        items: authorized.slice(0, SESSION_SEARCH_RESULT_LIMIT),
        hasMore: authorized.length > SESSION_SEARCH_RESULT_LIMIT,
      }
    } catch (error: unknown) {
      signal.throwIfAborted()
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED') {
        throw new RemoteError('gateway/cancelled', 'session search was aborted', {})
      }
      throw new RemoteError('gateway/internal', `session search failed: ${String(error)}`, {})
    }
  }

  private projectionsFor(
    header: SessionHeader,
    session: Session | undefined,
    selection?: ProjectionSelection,
  ): ProjectionRead {
    try {
      const kind = session === undefined ? 'cached' : 'sequenced'
      if (selection === undefined) {
        const hints = hintsOf(kind, this.readBlock(header, session))
        return hints === undefined ? {} : projectionReadOf(hints, undefined, hints.values[LIST_METADATA_KEY])
      }
      const keys = [...selection]
      const hints = keys.length === 0 ? undefined : hintsOf(kind, this.readBlock(header, session, keys))
      // Metadata is the row's own state, never part of a filtered column block: a
      // separate read keeps the block's watermark scoped to the caller's values.
      const metadata = hints?.values[LIST_METADATA_KEY]
        ?? hintsOf(kind, this.readBlock(header, session, [LIST_METADATA_KEY]))?.values[LIST_METADATA_KEY]
      return projectionReadOf(hints, selection, metadata)
    } catch (error) {
      this.ctx.logger.warn(
        `api-session.list: projection column for "${header.id}" failed; serving the row without it: ${String(error)}`,
      )
      return {}
    }
  }

  private readBlock(header: SessionHeader, session: Session | undefined, keys?: readonly string[]): ProjectionSnapshot | undefined {
    if (session !== undefined) {
      // The live registry computed the block for this Session: its watermark
      // shares the sequence space of the Session's baselines and frames.
      return this.ctx.sessionProjections.cachedSnapshot(session, projectionKeyList(keys))
    }
    // A cold row reads the persisted cache by header alone; the cache serves
    // seeded and unseeded lifecycles alike because a listing never seeds a
    // fold. The watermark is the stored record's own.
    const cache = this.ctx.get('sessionProjectionCache')
    return cache?.cachedSnapshot(header, projectionKeyList(keys))
      ?? (wantsTitle(keys) ? cache?.cachedPredecessorTitle(header) : undefined)
  }
}

/** Decode the wire selector once: `undefined` keeps the full read, and non-string entries are ignored. */
function projectionSelectionOf(projections: unknown): ProjectionSelection {
  if (!Array.isArray(projections)) return undefined
  return new Set(projections.filter((key): key is string => typeof key === 'string'))
}

function projectionKeyList(keys: readonly string[] | undefined): readonly Extract<keyof SessionProjectionMap, string>[] | undefined {
  // The wire selector is intentionally wider than the typed key union: unknown keys are ignored by the registry.
  return keys as readonly Extract<keyof SessionProjectionMap, string>[] | undefined
}

function wantsTitle(keys: readonly string[] | undefined): boolean {
  return keys === undefined || keys.includes('title')
}

/** Keep only the caller's columns, with the row's metadata supplied separately. */
function projectionReadOf(
  hints: SessionProjectionHints | undefined,
  selection?: ProjectionSelection,
  metadata?: SessionListMetadata,
): ProjectionRead {
  const values = hints === undefined
    ? undefined
    : selection === undefined
      ? hints.values
      : pickValues(hints.values, selection)
  return {
    ...(metadata === undefined ? {} : { metadata }),
    ...(hints === undefined || values === undefined || Object.keys(values).length === 0
      ? {}
      : { projections: { kind: hints.kind, asOfSeq: hints.asOfSeq, values } }),
  }
}

function pickValues(values: SessionProjectionValues, selection: ReadonlySet<string>): SessionProjectionValues {
  const picked: Record<string, SessionProjectionValues[string]> = {}
  for (const key of selection) {
    if (Object.hasOwn(values, key)) picked[key] = values[key]
  }
  return picked
}

/**
 * Wrap one projection block as Session-list hints of the named sequence space.
 * @param kind - which sequence space the block's watermark belongs to.
 * @param block - the block, or `undefined` when no source served one.
 * @returns the hints, or `undefined` when the block is absent or carries no value.
 */
function hintsOf(
  kind: SessionProjectionHints['kind'],
  block: ProjectionSnapshot | undefined,
): SessionProjectionHints | undefined {
  if (block === undefined || Object.keys(block.values).length === 0) return undefined
  // Listing hints contain every wire value the source currently holds but
  // remain partial: missing cells and cache rows are never materialized here.
  return { kind, asOfSeq: block.asOfSeq, values: block.values as SessionProjectionValues }
}

/**
 * Wait for a shared read while keeping one caller's own cancellation: the read survives, only this wait ends.
 * @param promise - shared work another caller may have started.
 * @param signal - caller's cancellation.
 * @returns the shared result, or throws the caller's abort reason.
 */
async function abortable<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  signal.throwIfAborted()
  let onAbort = (): void => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => { reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function normalizeSearchQuery(query: string): string {
  const normalized = query.trim()
  if (normalized.length === 0) {
    throw new RemoteError('gateway/bad-request', 'session search query must not be empty', {})
  }
  if (normalized.length > SESSION_SEARCH_QUERY_MAX_CHARS) {
    throw new RemoteError(
      'gateway/bad-request',
      `session search query must contain at most ${SESSION_SEARCH_QUERY_MAX_CHARS} UTF-16 code units`,
      {},
    )
  }
  if (normalized.includes('\0')) {
    throw new RemoteError('gateway/bad-request', 'session search query must not contain NUL', {})
  }
  return normalized
}

function updatedAt(header: SessionHeader, metadata: SessionListMetadata | undefined): number {
  return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0)
}

function listFields(header: SessionHeader): {
  readonly parentSessionId?: SessionId
  readonly origin?: 'subagent'
  readonly cwd?: string
} {
  return {
    ...(header.parentSession === undefined ? {} : { parentSessionId: header.parentSession }),
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
  }
}
