/** Live Session projection state with reconnect baselines. */

import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@deepseek-ai/dsh-deque'
import type {
  Session, SessionId,
} from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ProjectionPatches } from '@dshfiles/session-source-port/projection-patch'
import type {
  SessionControlBaseline,
  SessionControlFrame,
  SessionControlValueFrame,
  SessionProjectionBaseline,
  SessionProjectionUpdate,
  SessionProjectionValues,
} from './types.ts'

/** Owns the Host-wide Session control stream. */
export class SessionControlController {
  private readonly streams = new Set<ControlQueue>()

  /** @param ctx - Host context carrying live Agent and projection services. */
  constructor(private readonly ctx: Context) {
    ctx.sessionProjections.onEventChanged((session, changes, seq) => {
      this.broadcast({
        type: 'projection',
        sessionId: session.id,
        seq,
        // Every projection definition validates its value before change publication.
        changes: changes as SessionProjectionUpdate['changes'],
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
   * @param readable - dshfiles delta: whether this caller may read a Session, checked before a frame is queued.
   * @returns one complete baseline followed by live replacement frames.
   */
  async *control(signal: AbortSignal, readable: (sessionId: SessionId) => boolean): AsyncIterable<SessionControlValueFrame> {
    signal.throwIfAborted()
    const queue = new ControlQueue(readable)
    this.streams.add(queue)
    try {
      yield { type: 'baseline', value: this.baseline() }
      yield* queue.iterate(signal)
    } finally {
      this.streams.delete(queue)
      queue.end()
    }
  }

  /**
   * Publish one projection value of a Session another runtime owns. Its value and sequence are that runtime's, and a
   * mirrored Session is never in this Host's baseline, so the opening `follow` snapshot stays what it is compared with.
   * @param update - the owning runtime's finished value.
   */
  publishMirrored(update: { readonly sessionId: SessionId; readonly key: string; readonly value: JsonValue; readonly seq: number }): void {
    this.broadcast({ type: 'projection', sessionId: update.sessionId, seq: update.seq, changes: [{ key: update.key, val: update.value }] })
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

  private broadcast(frame: ProjectionFrame): void {
    const bytes = Buffer.byteLength(JSON.stringify(frame))
    for (const stream of this.streams) stream.push(frame, bytes)
  }
}

/**
 * dshfiles delta: one control stream's projection frames as patches from the value it sent last per cell. Every
 * running Session republishes whole projection values on each change; on the live Host `aiAccountsCost` (a per-turn
 * cost list) reached 28.5 KB per update and `turnOutline` 21.7 KB, 0.5 MB of the stream's 0.77 MB in 90 s.
 */
export class ProjectionPatchEncoder {
  /** Cells remembered per stream; past it the oldest cell's next change travels whole again. */
  private static readonly MAX_CELLS = 4_096
  private readonly sent = new Map<string, JsonValue>()

  encode(frame: Extract<SessionControlFrame, { readonly type: 'projection' }>): SessionControlFrame {
    let patched = false
    const changes = frame.changes.map((change) => {
      const cell = ProjectionPatches.cell(frame.sessionId, change.key)
      const previous = this.sent.get(cell)
      this.sent.delete(cell)
      this.sent.set(cell, change.val)
      if (this.sent.size > ProjectionPatchEncoder.MAX_CELLS) {
        const oldest = this.sent.keys().next()
        if (oldest.done !== true) this.sent.delete(oldest.value)
      }
      if (previous === undefined) return change
      const patch = ProjectionPatches.diff(previous, change.val)
      if (patch === 'replace') return change
      patched = true
      return { key: change.key, patch }
    })
    if (!patched) return frame
    return { type: 'projection-patch', sessionId: frame.sessionId, seq: frame.seq, changes }
  }
}

type ProjectionFrame = Extract<SessionControlValueFrame, { readonly type: 'projection' }>

export class ControlQueue {
  /**
   * A control frame is a replacement, so a client that reads slowly must not make the Host keep every change it missed:
   * the queue holds a bounded window and drops the oldest frames, and the newest value for a cell always survives.
   * Measured on the live Host: a connected client held gigabytes of queued frames while a long turn streamed updates.
   */
  private static readonly MAX_PENDING = 4_096
  /** A projection value can be large, so the queue also carries a byte budget: a frame count alone is not a bound. */
  private static readonly MAX_PENDING_BYTES = 4 * 1024 * 1024
  private readonly buffer = new Deque<{ readonly frame: ProjectionFrame; readonly bytes: number }>()
  private bufferedBytes = 0
  private wake: (() => void) | undefined
  private done = false

  /** @param readable - frames of a Session this stream's caller cannot read are never queued, so they cannot evict readable ones. */
  constructor(private readonly readable: (sessionId: SessionId) => boolean) {}

  /** @param bytes - the frame's serialized size, measured once by the broadcaster for every stream. */
  push(frame: ProjectionFrame, bytes: number): void {
    if (this.done || !this.readable(frame.sessionId)) return
    this.buffer.pushBack({ frame, bytes })
    this.bufferedBytes += bytes
    while (this.buffer.size > ControlQueue.MAX_PENDING || this.bufferedBytes > ControlQueue.MAX_PENDING_BYTES) {
      const dropped = this.buffer.popFront()
      if (dropped === undefined) break
      this.bufferedBytes -= dropped.bytes
    }
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  end(): void {
    if (this.done) return
    this.done = true
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }

  private take(): { readonly frame: ProjectionFrame; readonly bytes: number } | undefined {
    const entry = this.buffer.popFront()
    if (entry !== undefined) this.bufferedBytes -= entry.bytes
    return entry
  }

  async *iterate(signal: AbortSignal): AsyncIterable<SessionControlValueFrame> {
    const onAbort = (): void => { this.end() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!this.done && !signal.aborted) {
        const entry = this.take()
        if (entry !== undefined) {
          yield entry.frame
          continue
        }
        await new Promise<void>((resolve) => { this.wake = resolve })
      }
      for (let entry = this.take(); entry !== undefined && !signal.aborted; entry = this.take()) yield entry.frame
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.end()
    }
  }
}
