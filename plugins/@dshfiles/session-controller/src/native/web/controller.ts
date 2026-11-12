/** Web opening aggregation over one observation and a shared transforming buffer. */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import type { HistoryController } from '../history/controller.ts'
import { addressId, endsInsideTurn, pageRecords, rejectNotFound, tailOpening } from '../history.ts'
import { EventListener, ListenerBuffer, type ListenerBufferBudget } from '../history/listener.ts'
import { history, projections, resolveHistoryRequest, validateObservationAddress } from '../history/controller.ts'
import { coldReads } from '../cold-reads.ts'
import type { SessionFollowFrame, SessionFollowRequest, SessionHistoryRecord, SessionProjectionValues } from '../types.ts'

/**
 * dshfiles delta: one follow's queue bound. A frame count alone is not a memory bound (a durable event reaches 314 KB),
 * so the follower also carries a byte budget; past either, the follow ends and the client resyncs from a fresh opening.
 */
const FOLLOW_BUDGET: ListenerBufferBudget = {
  maxItems: 4_096,
  maxBytes: 8 * 1024 * 1024,
  bytesOf: (value) => {
    const item = value as { readonly type?: unknown; readonly event?: unknown }
    return item.type === 'event' ? Buffer.byteLength(JSON.stringify(item.event)) : 1_024
  },
}

/** Combines opening data and consumes transformed listener output from one queue. */
export class WebController {
  private readonly followers = new Map<SessionId, number>()

  /**
   * @param ctx - Host context carrying Session queries and identity projections.
   * @param historyController - passive reading and listener construction.
   * @param promote - background activation requested before an opening snapshot is delivered.
   */
  constructor(
    private readonly ctx: Context,
    private readonly historyController: HistoryController,
    private readonly promote: (observation: SessionObservation) => void,
  ) {}

  /** dshfiles: whether an open history follow still reads this Session, which keeps its Agent from idle eviction. */
  isFollowed(sessionId: SessionId): boolean {
    return this.followers.has(sessionId)
  }

  /**
   * Open a history snapshot and follow uncovered history and assistant notifications.
   * @param request - Session identity, page budget, assistant output and optional activation (default false).
   * @param signal - cancellation for opening and streaming.
   * @returns an opening snapshot followed by uncovered queued increments.
   */
  async *follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    const sessionId = addressId(request.address)
    const spec = resolveHistoryRequest(request)
    this.followers.set(sessionId, (this.followers.get(sessionId) ?? 0) + 1)
    try {
      using queue = new ListenerBuffer<SessionFollowFrame>(this.ctx, signal, FOLLOW_BUDGET)
      using listener = new EventListener(this.ctx, sessionId, signal, queue)
      const streams = this.historyController.streamsListener
      using assistantListener = request.assistantStream === true
        ? streams.bind(sessionId, signal, queue)
        : undefined
      const opening = await this.opening(request, spec, signal)
      listener.setCursor(opening.snapshot.cursor)
      let snapshot: SessionFollowFrame = opening.snapshot
      if (assistantListener !== undefined) {
        const { baseline: assistantStream, ordinal } = assistantListener.snapshot()
        snapshot = { ...snapshot, assistantStream }
        assistantListener.setOrdinalCut(ordinal)
      }
      const records = opening.records
      const promotion = opening.promotion
      if (promotion !== undefined) {
        try {
          this.promote(promotion)
        } catch (error: unknown) {
          promotion[Symbol.dispose]()
          throw error
        }
      }
      yield snapshot
      // The gateway carrier keeps the last frame it relayed until the next one arrives, and an idle follow sends none:
      // every open follow kept its opening records (1.86 GB across the live Host's follows), so they are emptied here.
      records.length = 0
      yield* queue.items()
    } finally {
      const remaining = (this.followers.get(sessionId) ?? 1) - 1
      if (remaining === 0) this.followers.delete(sessionId)
      else this.followers.set(sessionId, remaining)
    }
  }

  /**
   * dshfiles delta: the opening snapshot with every read it took already released. A cold Session opens from the end of
   * its log (see ../../tail-log.ts) under the cold-read limiter; the full read serves a live Session and every log the
   * tail cannot serve exactly. Opening a cold Session resumes its Agent only when its log stops inside a turn, so its
   * crash closers land while it is viewed; any other cold opening stays passive.
   */
  private async opening(
    request: SessionFollowRequest,
    spec: ReturnType<typeof resolveHistoryRequest>,
    signal: AbortSignal,
  ): Promise<{
    readonly snapshot: Extract<SessionFollowFrame, { readonly type: 'snapshot' }>
    /** The snapshot's own record array, emptied once the frame is delivered. */
    readonly records: SessionHistoryRecord[]
    readonly promotion?: SessionObservation
  }> {
    const sessionId = addressId(request.address)
    const cold = request.address.kind === 'session' && this.ctx.sessions.get(sessionId) === undefined
    const tail = cold ? await coldReads.use(() => tailOpening(this.ctx, sessionId, spec, signal)) : undefined
    if (tail === 'missing') rejectNotFound(request.address)
    if (tail !== undefined) {
      const records = pageRecords(tail.page.events)
      return {
        snapshot: {
          type: 'snapshot',
          header: { ...tail.header },
          projections: { asOfSeq: tail.projections.asOfSeq, values: tail.projections.values as SessionProjectionValues },
          cursor: tail.cursor,
          records,
          hasMore: tail.page.hasMore,
        },
        records,
      }
    }
    const observe = (): Promise<SessionObservation> => this.historyController.usingObservation({ sessionId, projection: true }, signal)
    using observation = await (cold ? coldReads.use(observe) : observe())
      .catch((error: unknown) => {
        if (remoteErrorOf(error)?.code === 'session/not-found') rejectNotFound(request.address)
        throw error
      })
    validateObservationAddress(request.address, observation)
    const page = history(observation, spec)
    const records = [...page.records]
    const snapshot: Extract<SessionFollowFrame, { readonly type: 'snapshot' }> = {
      type: 'snapshot',
      header: { ...observation.header },
      projections: projections(observation),
      cursor: page.cursor,
      records,
      hasMore: page.hasMore,
    }
    const promote = request.activate === true && !signal.aborted
      && observation.header.origin !== 'subagent' && observation.source === 'prepared'
      && endsInsideTurn(observation.events)
    return promote ? { snapshot, records, promotion: observation.retain() } : { snapshot, records }
  }
}
