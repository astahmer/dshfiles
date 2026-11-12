/** Shared Session history pagination, address validation and wire conversion. */

import {
  isAppendSurfaceEvent,
  SessionLogOffset,
} from '@deepseek-ai/dsh-session'
import type {
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset as SessionLogOffsetType,
  SessionSeqCursor,
} from '@deepseek-ai/dsh-session'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionAddress,
  SessionEventEntry,
  SessionEventsPage,
  SessionFollowRequest,
  SessionHistoryRecord,
  SessionPageRequest,
  SessionWireEvent,
} from './types.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { LogWindowMetrics } from '@dshfiles/session-log-window'
import { BrowserEvent } from '../browser-event.ts'
import { TailLog } from '../tail-log.ts'

/** Message budget applied when a history request omits `maxMessages`. */
export const DEFAULT_MAX_MESSAGES = 50
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

/**
 * dshfiles: whether a log stops inside a turn, the one cold opening that still resumes its Agent.
 * @param events - contiguous Session events.
 * @returns whether the last turn marker is an open `turn/start`.
 */
export function endsInsideTurn(events: readonly SessionEvent[]): boolean {
  return lastTurnMarker(events) === 'turn/start'
}

function lastTurnMarker(events: readonly SessionEvent[]): 'turn/start' | 'turn/end' | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = events[index]?.type
    if (type === 'turn/end' || type === 'turn/start') return type
  }
  return undefined
}

/**
 * The opening snapshot of a cold Session from the end of its log: frames are decoded backwards until the opening
 * window is settled, and projections fold the cached checkpoint over that tail. `undefined` sends the caller to the
 * full read, including a log that stops inside a turn, which the full read resumes to close.
 */
export async function tailOpening(
  ctx: Context,
  sessionId: SessionId,
  request: Pick<SessionFollowRequest, 'maxMessages' | 'turnWindow'>,
  signal: AbortSignal,
): Promise<{
  readonly header: SessionHeader
  readonly cursor: SessionSeqCursor
  readonly page: { readonly events: SessionEvent[]; readonly hasMore: boolean }
  readonly projections: NonNullable<SessionObservation['projections']>
} | 'missing' | undefined> {
  try {
    const metrics: LogWindowMetrics = {}
    const log = await TailLog.open({ ctx, sessionId, signal, metrics })
    if (log === undefined) return storedLogMissing(ctx, sessionId, metrics) ? 'missing' : undefined
    for (let frames = 16; ; frames *= 2) {
      signal.throwIfAborted()
      const decoded = log.decodedFrames
      const events = log.before(frames)
      const last = events.at(-1)
      if (last === undefined) return undefined
      const marker = lastTurnMarker(events)
      if (marker === 'turn/start') return undefined
      const page = paginate(events, undefined, request.maxMessages ?? DEFAULT_MAX_MESSAGES, last.seq, request.turnWindow, log.base)
      if ((marker === undefined || !page.settled) && !log.complete) {
        // A window that decoded its first frame holds nothing further back: the full read serves the rest.
        if (log.decodedFrames === decoded) return undefined
        continue
      }
      if (!page.settled) return undefined
      const projections = log.restore(ctx)
      return projections === undefined ? undefined : { header: log.header, cursor: last.seq, page, projections }
    }
  } catch (error: unknown) {
    if (signal.aborted) throw error
    ctx.logger.warn(`session-controller: tail opening for "${sessionId}" fell back to the full read: ${String(error)}`)
    return undefined
  }
}

/**
 * The tail's own lookup found no stored log and the Session is still not attached, so the full read could only repeat
 * that lookup (a walk of every project directory) and answer not-found. A local draft the browser never created here
 * is this case.
 */
function storedLogMissing(ctx: Context, sessionId: SessionId, metrics: LogWindowMetrics): boolean {
  return metrics.fallback_reason === 'stat-missing' && ctx.sessions.get(sessionId) === undefined
}

/**
 * One older page of a cold Session from the end of its log, decoding further back until the page is settled.
 * `undefined` sends the caller to the full read, which also owns every request error.
 */
export async function tailPageOf(
  ctx: Context,
  sessionId: SessionId,
  request: {
    readonly beforeSeq: SessionLogOffsetType | undefined
    /** Inclusive cut; `undefined` selects the end of the stored log. */
    readonly throughSeq: SessionSeqCursor | undefined
    readonly maxMessages: number
    readonly turnWindow?: SessionPageRequest['turnWindow'] | undefined
  },
  signal: AbortSignal,
): Promise<SessionEventsPage | 'missing' | undefined> {
  try {
    const metrics: LogWindowMetrics = {}
    const log = await TailLog.open({ ctx, sessionId, signal, metrics })
    if (log === undefined) return storedLogMissing(ctx, sessionId, metrics) ? 'missing' : undefined
    // A page through seq -1 holds nothing: the sidebar asks for it on hover so the click finds the tail already open.
    if (request.throughSeq !== undefined && request.throughSeq < 0) return { cursor: -1, records: [], hasMore: true }
    for (let frames = 16; ; frames *= 2) {
      signal.throwIfAborted()
      const decoded = log.decodedFrames
      const events = log.before(frames)
      const last = events.at(-1)?.seq
      if (last === undefined) return undefined
      const cursor = request.throughSeq ?? last
      if (cursor > last) return undefined
      const page = paginate(events, request.beforeSeq, request.maxMessages, cursor, request.turnWindow, log.base)
      if (page.settled) return { cursor, records: pageRecords(page.events), hasMore: page.hasMore }
      // A window that decoded its first frame holds nothing further back: the full read serves the rest.
      if (log.complete || log.decodedFrames === decoded) return undefined
    }
  } catch (error: unknown) {
    if (signal.aborted) throw error
    ctx.logger.warn(`session-controller: tail page for "${sessionId}" fell back to the full read: ${String(error)}`)
    return undefined
  }
}

/**
 * Reject an invalid message budget or turn window.
 * @param request - history window fields.
 */
export function validateHistoryWindow(request: Pick<SessionPageRequest, 'maxMessages' | 'turnWindow'>): void {
  if (request.maxMessages !== undefined
    && (!Number.isSafeInteger(request.maxMessages) || request.maxMessages <= 0)) {
    throw new RemoteError('gateway/bad-request', 'maxMessages must be a positive safe integer', {})
  }
  const window = request.turnWindow
  if (window !== undefined) {
    if (!Number.isSafeInteger(window.minMessages) || window.minMessages <= 0
      || window.minMessages > (request.maxMessages ?? DEFAULT_MAX_MESSAGES)) {
      throw new RemoteError('gateway/bad-request', 'turnWindow.minMessages must be a positive safe integer no greater than maxMessages', {})
    }
    if (!Number.isSafeInteger(window.minTurns) || window.minTurns <= 0) {
      throw new RemoteError('gateway/bad-request', 'turnWindow.minTurns must be a positive safe integer', {})
    }
  }
}

/**
 * Select the Session whose log an address names.
 * @param address - ordinary Session or direct-subagent address.
 * @returns the Session whose log the address reads.
 */
export function addressId(address: SessionAddress): SessionId {
  return address.kind === 'session' ? address.sessionId : address.childSessionId
}

/**
 * Reject an address that does not match the observed Session.
 * @param address - ordinary Session or direct-subagent address.
 * @param header - observed Session header.
 * @param inheritedEventCount - observed fork-inherited event count.
 * @param projections - observed projections; subagent addresses require them.
 */
export function validateAddress(
  address: SessionAddress,
  header: SessionHeader,
  inheritedEventCount: SessionLogOffsetType,
  projections: SessionObservation['projections'],
): void {
  if (address.kind === 'session') {
    if (header.origin === 'subagent') {
      throw new RemoteError('session/agent-busy', 'subagent Sessions require their durable parent address', {
        reason: 'use subagent delivery for this child session',
      })
    }
    return
  }
  if (header.origin !== 'subagent' || header.parentSession !== address.parentSessionId) {
    throw new RemoteError('subagent/unauthorized', 'subagent does not belong to the supplied parent', {
      childSessionId: address.childSessionId,
    })
  }
  const identity = projections?.values.subagent
  if (identity === null) {
    throw new RemoteError('subagent/catalog-diagnostic', 'subagent descriptor is corrupt', {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: 'corrupt',
    })
  }
  if (identity === undefined || identity.seq < inheritedEventCount) {
    throw new RemoteError('subagent/catalog-diagnostic', 'subagent descriptor is unavailable', {
      parentSessionId: address.parentSessionId,
      childSessionId: address.childSessionId,
      reason: 'unsupported',
    })
  }
  if (address.mode !== 'unknown' && identity.mode !== address.mode) {
    throw new RemoteError('subagent/unauthorized', 'subagent mode does not match the supplied address', {
      childSessionId: address.childSessionId,
    })
  }
}

/**
 * Reject a missing Session using its address-specific error.
 * @param address - ordinary Session or direct-subagent address.
 * @returns never; this operation always throws.
 * @throws RemoteError `session/not-found` or `subagent/not-found`.
 */
export function rejectNotFound(address: SessionAddress): never {
  if (address.kind === 'session') {
    throw new RemoteError('session/not-found', `session "${address.sessionId}" not found`, { sessionId: address.sessionId })
  }
  throw new RemoteError('subagent/not-found', 'subagent is unavailable', {
    parentSessionId: address.parentSessionId,
    childSessionId: address.childSessionId,
  })
}

/**
 * Cut one message-aligned backwards page from a contiguous event prefix.
 * @param events - contiguous events starting at seq 0.
 * @param beforeSeq - exclusive upper offset of an older page.
 * @param maxMessages - message budget.
 * @param throughSeq - inclusive log cut.
 * @param turnWindow - optional turn-boundary stop rule.
 * @returns the page events and whether older events remain.
 */
export function paginate(
  events: readonly SessionEvent[],
  beforeSeq: SessionLogOffsetType | undefined,
  maxMessages: number,
  throughSeq: SessionSeqCursor,
  turnWindow?: SessionPageRequest['turnWindow'],
  base = 0,
): { readonly events: SessionEvent[]; readonly hasMore: boolean; readonly settled: boolean } {
  // dshfiles delta: `events` may start at seq `base` (a decoded log tail); `settled` says whether the window was
  // decided inside it.
  const end = SessionLogOffset(Math.min(throughSeq + 1, beforeSeq ?? throughSeq + 1))
  let count = 0
  let turns = 0
  let cut: number | undefined
  for (let index = end - 1; index >= base; index--) {
    const event = events[index - base] as SessionEvent
    if (turnWindow !== undefined && event.type === 'turn/start') {
      turns++
      if (count >= turnWindow.minMessages && turns >= turnWindow.minTurns) {
        cut = index
        break
      }
    }
    if (!MESSAGE_TYPES.has(event.type) || !isAppendSurfaceEvent(event)) continue
    count++
    const sources = event.sourceEventSeqs
    let groupStart = event.seq
    if (sources !== undefined) {
      for (const source of sources) {
        if (source < groupStart) groupStart = source
      }
    }
    if (count >= maxMessages) {
      cut = groupStart
      break
    }
  }
  if (cut === undefined && base === 0) cut = 0
  if (cut === undefined || cut < base) return { events: [], hasMore: true, settled: false }
  return { events: events.slice(cut - base, end - base), hasMore: cut > 0, settled: true }
}

/**
 * Convert a committed event to its wire entry.
 * @param event - committed Session event.
 * @returns the wire event entry.
 */
export function entryFor(event: SessionEvent): SessionEventEntry {
  return {
    type: 'event',
    // Session.append validates and freezes event data as JSON before publication.
    event: BrowserEvent.of(event) as unknown as SessionWireEvent,
  }
}

/**
 * Encode one bounded logical page without changing its pagination cut.
 * @param events - page events.
 * @returns the wire records.
 */
export function pageRecords(events: readonly SessionEvent[]): SessionHistoryRecord[] {
  return events.map(entryFor)
}
