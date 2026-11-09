/** Cold Session history pagination and live-event source. */

import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { AssistantStreamFrame } from '@deepseek-ai/dsh-agent'
import {
  isAppendSurfaceEvent,
  SessionLogOffset,
  SessionSeq,
} from '@deepseek-ai/dsh-session'
import type {
  SessionEvent,
  SessionHeader,
  SessionId,
  SessionLogOffset as SessionLogOffsetType,
  SessionSeqCursor,
} from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  SessionAddress,
  SessionAssistantStreamFrame,
  SessionEventEntry,
  SessionFollowRequest,
  SessionFollowFrame,
  SessionHistoryRecord,
  SessionPage,
  SessionPageRequest,
  SessionProjectionBaseline,
  SessionProjectionValues,
  SessionWireHeader,
  SessionWireEvent,
} from './types.ts'
import { SessionAssistantStreamAccumulator } from './assistant-stream.ts'
import { coldReads } from './cold-reads.ts'
import { BrowserEvent } from '../browser-event.ts'
import { TailLog } from '../tail-log.ts'
import type { LogWindowMetrics } from '@dshfiles/session-log-window'

const DEFAULT_MAX_MESSAGES = 50
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

/** Implements cold-safe history operations delegated by the Session Controller. */
export class SessionHistoryController {
  private readonly closeFollowers = new Set<() => void>()
  private readonly assistantStreams = new Map<SessionId, SessionAssistantStreamAccumulator>()
  private readonly followers = new Map<SessionId, number>()

  /**
   * @param ctx - Host context carrying Session query and projection services.
   * @param promote - starts ordinary Session activation after snapshot delivery, for a log left inside a turn.
   */
  constructor(
    private readonly ctx: Context,
    private readonly promote: (observation: SessionObservation) => void,
  ) {
    ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      let stream = this.assistantStreams.get(agent.session.id)
      if (stream === undefined) {
        stream = new SessionAssistantStreamAccumulator()
        this.assistantStreams.set(agent.session.id, stream)
      }
      stream.accept(frame, cursorBeforeNext(agent.session.seq))
    }, { global: true })
    ctx.on('agent/disposed', ({ agent }) => {
      this.assistantStreams.delete(agent.session.id)
    }, { global: true })
    ctx.effect(() => () => {
      for (const close of this.closeFollowers) close()
      this.closeFollowers.clear()
    }, 'session-controller.history')
  }

  /** dshfiles: whether an open history follow still reads this Session, which keeps its Agent from idle eviction. */
  isFollowed(sessionId: SessionId): boolean {
    return this.followers.has(sessionId)
  }

  /**
   * Read one message-aligned history page without activating an Agent.
   * @param request - durable address and backwards-page cursor.
   * @param signal - caller cancellation for persistence reads.
   * @returns a contiguous event page.
   */
  async page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    validatePageRequest(request)
    const throughSeq: SessionSeqCursor = request.throughSeq === -1
      ? -1
      : SessionSeq(request.throughSeq)
    const beforeSeq = request.beforeSeq === undefined
      ? undefined
      : SessionLogOffset(request.beforeSeq)
    const cold = request.address.kind === 'session' && this.ctx.sessions.get(request.address.sessionId) === undefined
    if (!cold) return this.readPage(request, beforeSeq, throughSeq, signal)
    return coldReads.use(() => this.readPage(request, beforeSeq, throughSeq, signal))
  }

  private async readPage(
    request: SessionPageRequest,
    beforeSeq: SessionLogOffsetType | undefined,
    throughSeq: SessionSeqCursor,
    signal: AbortSignal,
  ): Promise<SessionPage> {
    // dshfiles delta: an older page of a cold Session comes from the same log tail its opening decoded.
    if (request.address.kind === 'session' && this.ctx.sessions.get(request.address.sessionId) === undefined) {
      const tailPage = await tailPageOf(this.ctx, request.address.sessionId, { ...request, beforeSeq, throughSeq }, signal)
      if (tailPage === 'missing') rejectNotFound(request.address)
      if (tailPage !== undefined) return tailPage
    }
    using source = await this.sourceFor(request.address, signal, false)
    signal.throwIfAborted()
    const sourceLog = source.events
    const sourceCursor: SessionSeqCursor = sourceLog.at(-1)?.seq ?? -1
    if (throughSeq > sourceCursor) {
      throw new RemoteError(
        'gateway/bad-request',
        `session page through seq ${String(throughSeq)} is past cursor ${String(sourceCursor)}`,
        {},
      )
    }
    /* v8 ignore next -- Session and persistence validation guarantee a dense zero-based event prefix. */
    if (throughSeq >= 0 && sourceLog[throughSeq]?.seq !== throughSeq) {
      throw new RemoteError('gateway/internal', `session log does not contain through seq ${String(throughSeq)}`, {})
    }
    const page = paginate(
      sourceLog,
      beforeSeq,
      request.maxMessages ?? DEFAULT_MAX_MESSAGES,
      throughSeq,
      request.turnWindow,
    )
    const records = pageRecords(page.events)
    return {
      records,
      hasMore: page.hasMore,
    }
  }

  /**
   * Follow events appended after an initial cursor on one durable address.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - stream cancellation owned by the Remote carrier.
   * @returns a complete opening snapshot followed by gap-free durable events and opted-in assistant frames.
   */
  async *follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    validateHistoryWindow(request)
    const { address } = request
    const target = addressId(address)
    type FollowItem =
      | { readonly type: 'event'; readonly event: SessionEvent }
      | {
        readonly type: 'assistant-stream'
        readonly frame: SessionAssistantStreamFrame
        readonly ordinal: number
      }
    const buffered = new Deque<FollowItem & { readonly bytes: number }>()
    let snapshotCursor: SessionSeqCursor | undefined
    let assistantStreamOrdinal = 0
    let wake: (() => void) | undefined
    const notify = (): void => {
      const resume = wake
      wake = undefined
      resume?.()
    }
    const follower = { closed: false }
    const close = (): void => {
      follower.closed = true
      notify()
    }
    /**
     * A client that reads slower than the Session writes must not grow Host memory without bound: this buffer held
     * every streamed frame of a long turn (measured: ~650k retained chunks against a 3 GB heap). Past the cap the
     * follower ends and the client resyncs from a fresh snapshot instead of the Host queueing frames nobody read.
     */
    const MAX_BUFFERED_FRAMES = 4_096
    // A frame count alone is not a memory bound: a durable Session event reaches 314 KB here, so 4,096 of them would be
    // over a gigabyte. The follower also carries a byte budget, and a lagging client resyncs from a fresh snapshot.
    const MAX_BUFFERED_BYTES = 8 * 1024 * 1024
    let bufferedBytes = 0
    // Measured once on arrival: the event is serialized for its size here, not again when the queue checks or drains it.
    const measured = (item: FollowItem): (FollowItem & { readonly bytes: number }) | undefined => {
      if (follower.closed) return undefined
      const bytes = item.type === 'assistant-stream' ? 1_024 : Buffer.byteLength(JSON.stringify(item))
      if (buffered.size >= MAX_BUFFERED_FRAMES || bufferedBytes + bytes > MAX_BUFFERED_BYTES) {
        follower.closed = true
        notify()
        return undefined
      }
      bufferedBytes += bytes
      return { ...item, bytes }
    }
    const pushBack = (item: FollowItem): void => {
      const entry = measured(item)
      if (entry === undefined) return
      buffered.pushBack(entry)
      notify()
    }
    const pushFront = (item: FollowItem): void => {
      const entry = measured(item)
      if (entry === undefined) return
      buffered.pushFront(entry)
      notify()
    }
    this.closeFollowers.add(close)
    this.followers.set(target, (this.followers.get(target) ?? 0) + 1)
    const disposeEvent = this.ctx.on('session/event', (session, event) => {
      if (session.id !== target) return
      pushBack({ type: 'event', event })
    }, { global: true })
    const disposeCreated = this.ctx.on('session/created', (session) => {
      if (session.id !== target) return
      // Constructor seed events have no session/event notification. Normally
      // only the end-seed suffix is new; if persistence advanced after the
      // opening observation, replay everything beyond that snapshot cursor.
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const suffix = session.snapshotEvents(snapshotCursor === undefined
        ? session.firstLiveSeq
        : SessionLogOffset(snapshotCursor + 1))
      for (let index = suffix.length - 1; index >= 0; index -= 1) {
        pushFront({ type: 'event', event: suffix[index] as SessionEvent })
      }
    }, { global: true })
    const disposeAssistantStream = request.assistantStream !== true
      ? undefined
      : this.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
        if (agent.session.id !== target) return
        pushBack({
          type: 'assistant-stream',
          frame: wireAssistantStreamFrame(frame, cursorBeforeNext(agent.session.seq)),
          ordinal: ++assistantStreamOrdinal,
        })
      }, { global: true })
    const onAbort = (): void => { notify() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      // dshfiles delta: a cold Session opens from the end of its log (see ../tail-log.ts); the full read stays the path
      // for a live Session and for every log the tail cannot serve exactly.
      const cold = address.kind === 'session' && this.ctx.sessions.get(target) === undefined
      const opened = cold ? await coldReads.use(() => tailOpening(this.ctx, target, request, signal)) : undefined
      if (opened === 'missing') rejectNotFound(address)
      const tail = opened
      using source = tail !== undefined
        ? undefined
        : await (cold ? coldReads.use(() => this.sourceFor(address, signal, true)) : this.sourceFor(address, signal, true))
      signal.throwIfAborted()
      const opening = tail ?? (source === undefined ? undefined : {
        header: source.header,
        cursor: source.cursor,
        page: paginate(source.events, undefined, request.maxMessages ?? DEFAULT_MAX_MESSAGES, source.cursor, request.turnWindow),
        projections: source.projections,
      })
      /* v8 ignore next -- one of the two reads always produces the opening. */
      if (opening === undefined) throw new RemoteError('gateway/internal', 'session follow produced no opening', {})
      const { cursor, page } = opening
      snapshotCursor = cursor
      const assistantStream = request.assistantStream === true
        ? this.assistantStreams.get(target)?.snapshot() ?? { revision: 0 }
        : undefined
      // The accumulator snapshot and this watermark are synchronous. Frames
      // through the cut are represented or superseded by that baseline,
      // including larger revisions from a retired Agent; later revision
      // resets reach Client continuity validation.
      const assistantStreamOrdinalCut = assistantStreamOrdinal
      yield {
        type: 'snapshot',
        header: wireHeader(opening.header),
        cursor,
        records: pageRecords(page.events),
        hasMore: page.hasMore,
        projections: opening.projections === undefined
          ? { asOfSeq: cursor, values: {} }
          : projectionBlock(opening.projections),
        ...assistantStream === undefined ? {} : { assistantStream },
      }
      // dshfiles delta: opening a cold Session no longer resumes its Agent (about 1.2 s of main-thread work on a long
      // thread, right as the snapshot is delivered). The first command resolves it from the preparation this follow
      // keeps pinned; a log that stops inside a turn still resumes now, so its crash closers land while it is viewed.
      if (address.kind === 'session' && source?.source === 'prepared' && endsInsideTurn(source.events)) {
        const promotion = source.retain()
        try {
          this.promote(promotion)
        } catch (error: unknown) {
          promotion[Symbol.dispose]()
          throw error
        }
      }
      let nextOffset = SessionLogOffset(cursor + 1)
      // The budget is a queue depth, not a lifetime cap: what the consumer takes leaves the queue.
      const take = (): (typeof buffered extends Deque<infer Item> ? Item : never) | undefined => {
        const item = buffered.popFront()
        if (item !== undefined) bufferedBytes -= item.bytes
        return item
      }
      while (!follower.closed && !signal.aborted) {
        const item = take()
        if (item === undefined) {
          await new Promise<void>((resolve) => { wake = resolve })
          continue
        }
        if (item.type === 'assistant-stream') {
          if (item.ordinal > assistantStreamOrdinalCut) {
            yield { type: 'assistant-stream', frame: item.frame }
          }
          continue
        }
        const expectedSeq = SessionSeq(nextOffset)
        if (item.event.seq < expectedSeq) continue
        if (item.event.seq !== expectedSeq) {
          throw new RemoteError('gateway/internal', `session event stream skipped seq ${String(expectedSeq)}`, {})
        }
        nextOffset = SessionLogOffset(nextOffset + 1)
        yield entryFor(item.event)
      }
    } finally {
      this.closeFollowers.delete(close)
      const remaining = (this.followers.get(target) ?? 1) - 1
      if (remaining === 0) this.followers.delete(target)
      else this.followers.set(target, remaining)
      signal.removeEventListener('abort', onAbort)
      disposeCreated()
      disposeEvent()
      disposeAssistantStream?.()
    }
  }

  private async sourceFor(
    address: SessionAddress,
    signal: AbortSignal,
    withProjections: boolean,
  ): Promise<SessionObservation> {
    const sessionId = addressId(address)
    try {
      const observation = await this.ctx.sessionQuery.observeSession(sessionId, {
        signal,
        projectionMode: withProjections || address.kind === 'subagent' ? 'all' : 'none',
      })
      if (observation.header.cwd === undefined) {
        observation[Symbol.dispose]()
        rejectNotFound(address)
      }
      try {
        validateAddress(
          address,
          observation.header,
          observation.inheritedEventCount,
          observation.projections,
        )
      } catch (error: unknown) {
        observation[Symbol.dispose]()
        throw error
      }
      return observation
    } catch (error: unknown) {
      if (error instanceof SessionQueryError
        && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') rejectNotFound(address)
      throw error
    }
  }

}

function endsInsideTurn(events: readonly SessionEvent[]): boolean {
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
async function tailOpening(
  ctx: Context,
  sessionId: SessionId,
  request: SessionFollowRequest,
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
async function tailPageOf(
  ctx: Context,
  sessionId: SessionId,
  request: {
    readonly beforeSeq: SessionLogOffsetType | undefined
    readonly throughSeq: SessionSeqCursor
    readonly maxMessages?: number
    readonly turnWindow?: SessionPageRequest['turnWindow']
  },
  signal: AbortSignal,
): Promise<SessionPage | 'missing' | undefined> {
  try {
    const metrics: LogWindowMetrics = {}
    const log = await TailLog.open({ ctx, sessionId, signal, metrics })
    if (log === undefined) return storedLogMissing(ctx, sessionId, metrics) ? 'missing' : undefined
    // A page through seq -1 holds nothing: the sidebar asks for it on hover so the click finds the tail already open.
    if (request.throughSeq < 0) return { records: [], hasMore: true }
    for (let frames = 16; ; frames *= 2) {
      signal.throwIfAborted()
      const decoded = log.decodedFrames
      const events = log.before(frames)
      const cursor = events.at(-1)?.seq
      if (cursor === undefined || request.throughSeq > cursor) return undefined
      const page = paginate(events, request.beforeSeq, request.maxMessages ?? DEFAULT_MAX_MESSAGES, request.throughSeq, request.turnWindow, log.base)
      if (page.settled) return { records: pageRecords(page.events), hasMore: page.hasMore }
      // A window that decoded its first frame holds nothing further back: the full read serves the rest.
      if (log.complete || log.decodedFrames === decoded) return undefined
    }
  } catch (error: unknown) {
    if (signal.aborted) throw error
    ctx.logger.warn(`session-controller: tail page for "${sessionId}" fell back to the full read: ${String(error)}`)
    return undefined
  }
}

function cursorBeforeNext(nextSeq: SessionLogOffsetType): SessionSeqCursor {
  return nextSeq === 0 ? -1 : SessionSeq(nextSeq - 1)
}

function wireAssistantStreamFrame(
  frame: AssistantStreamFrame,
  durableCursor: SessionSeqCursor,
): SessionAssistantStreamFrame {
  if (frame.type === 'start') return { ...frame, startedAfterSeq: durableCursor }
  if (frame.type === 'end') return frame
  return {
    ...frame,
    chunk: frame.chunk as JsonValue,
  }
}

function projectionBlock(
  snapshot: NonNullable<SessionObservation['projections']>,
): SessionProjectionBaseline {
  return {
    asOfSeq: snapshot.asOfSeq,
    // Projection definitions validate whole JSON values before snapshot publication.
    values: snapshot.values as SessionProjectionValues,
  }
}

function validatePageRequest(request: SessionPageRequest): void {
  if (!Number.isSafeInteger(request.throughSeq)
    || request.throughSeq < -1
    || Object.is(request.throughSeq, -0)) {
    throw new RemoteError('gateway/bad-request', 'throughSeq must be an integer greater than or equal to -1', {})
  }
  if (request.beforeSeq !== undefined
    && (!Number.isSafeInteger(request.beforeSeq)
      || request.beforeSeq < 0
      || Object.is(request.beforeSeq, -0))) {
    throw new RemoteError('gateway/bad-request', 'beforeSeq must be a non-negative safe integer', {})
  }
  validateHistoryWindow(request)
}

function validateHistoryWindow(request: Pick<SessionPageRequest, 'maxMessages' | 'turnWindow'>): void {
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

function addressId(address: SessionAddress): SessionId {
  return address.kind === 'session' ? address.sessionId : address.childSessionId
}

function validateAddress(
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

function rejectNotFound(address: SessionAddress): never {
  if (address.kind === 'session') {
    throw new RemoteError('session/not-found', `session "${address.sessionId}" not found`, { sessionId: address.sessionId })
  }
  throw new RemoteError('subagent/not-found', 'subagent is unavailable', {
    parentSessionId: address.parentSessionId,
    childSessionId: address.childSessionId,
  })
}

function paginate(
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

/** Translate current logical Session metadata to the browser wire. */
function wireHeader(header: SessionHeader): SessionWireHeader {
  return { ...header }
}

function entryFor(event: SessionEvent): SessionEventEntry {
  return {
    type: 'event',
    // Session.append validates and freezes event data as JSON before publication.
    event: BrowserEvent.of(event) as unknown as SessionWireEvent,
  }
}

/** Encode one bounded logical page without changing its pagination cut. */
function pageRecords(events: readonly SessionEvent[]): SessionHistoryRecord[] {
  return events.map(entryFor)
}
