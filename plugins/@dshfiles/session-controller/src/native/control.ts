/** Live Session projection state with reconnect baselines. */

import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@deepseek-ai/dsh-deque'
import type {
  Session, SessionId,
} from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {
  SessionControlBaseline,
  SessionControlFrame,
  SessionProjectionBaseline,
  SessionProjectionValues,
} from './types.ts'

/** Owns the Host-wide Session control stream. */
export class SessionControlController {
  private readonly streams = new Set<ControlQueue>()

  /** @param ctx - Host context carrying live Agent and projection services. */
  constructor(private readonly ctx: Context) {
    ctx.sessionProjections.onChanged((session, key, value, seq) => {
      this.broadcast({
        type: 'projection',
        sessionId: session.id,
        key,
        value: value as JsonValue,
        seq,
      })
    })
    ctx.effect(() => () => {
      for (const stream of this.streams) stream.end()
      this.streams.clear()
    }, 'session-controller.control')
  }

  /**
   * Open one generation of Host-wide live control state.
   * @param signal - Remote stream cancellation.
   * @returns one complete baseline followed by live replacement frames.
   */
  async *control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    signal.throwIfAborted()
    const queue = new ControlQueue()
    this.streams.add(queue)
    try {
      yield { type: 'baseline', value: this.baseline() }
      yield* queue.iterate(signal)
    } finally {
      this.streams.delete(queue)
      queue.end()
    }
  }

  private baseline(): SessionControlBaseline {
    const sessions = this.ctx.sessions.list()
    return {
      projections: this.projectionBaseline(sessions),
    }
  }

  private projectionBaseline(
    sessions: readonly Session[],
  ): Readonly<Record<SessionId, SessionProjectionBaseline>> {
    const blocks = Object.create(null) as Record<SessionId, SessionProjectionBaseline>
    for (const session of sessions) {
      const snapshot = this.ctx.sessionProjections.snapshot(session)
      blocks[session.id] = {
        asOfSeq: snapshot.asOfSeq,
        // Every projection definition validates its value before snapshot publication.
        values: snapshot.values as SessionProjectionValues,
      }
    }
    return blocks
  }

  private broadcast(frame: SessionControlFrame): void {
    for (const stream of this.streams) stream.push(frame)
  }
}

export class ControlQueue {
  /**
   * A control frame is a replacement, so a client that reads slowly must not make the Host keep every change it missed:
   * the queue holds a bounded window and drops the oldest frames, and the newest value for a cell always survives.
   * Measured on the live Host: a connected client held gigabytes of queued frames while a long turn streamed updates.
   */
  private static readonly MAX_PENDING = 4_096
  /** A projection value can be large, so the queue also carries a byte budget: a frame count alone is not a bound. */
  private static readonly MAX_PENDING_BYTES = 4 * 1024 * 1024
  private readonly buffer = new Deque<SessionControlFrame>()
  private bufferedBytes = 0
  private wake: (() => void) | undefined
  private done = false

  push(frame: SessionControlFrame): void {
    if (this.done) return
    const bytes = ControlQueue.bytesOf(frame)
    this.buffer.pushBack(frame)
    this.bufferedBytes += bytes
    while (this.buffer.size > ControlQueue.MAX_PENDING || this.bufferedBytes > ControlQueue.MAX_PENDING_BYTES) {
      const dropped = this.buffer.popFront()
      if (dropped === undefined) break
      this.bufferedBytes -= ControlQueue.bytesOf(dropped)
    }
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  private static bytesOf(frame: SessionControlFrame): number {
    return Buffer.byteLength(JSON.stringify(frame))
  }

  end(): void {
    if (this.done) return
    this.done = true
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  async *iterate(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!this.done && !signal.aborted) {
        const frame = this.buffer.popFront()
        if (frame !== undefined) {
          yield frame
          continue
        }
        await new Promise<void>((resolve) => { this.wake = resolve })
      }
      while (this.buffer.size > 0 && !signal.aborted) yield this.buffer.popFront() as SessionControlFrame
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.end()
    }
  }
}
