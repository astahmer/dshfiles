import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { SessionAttentionStore } from './attention-store.ts'
import type { SessionAttentionSummary, SessionAttentionUpdateRequest } from './types.ts'
import type {} from './types.ts'

const sessionAttentionRequestSchema = z.object({
  sessionId: z.string().min(1),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('mark-read') }).strict(),
    z.object({ type: z.literal('set-snoozed'), snoozed: z.boolean() }).strict(),
  ]),
}).strict()

export class ApiSessionAttention {
  private readonly store = new SessionAttentionStore()
  private promptTail: Promise<void> = Promise.resolve()
  private promptFailure: { readonly error: unknown } | undefined
  readonly ready: Promise<void>

  constructor(private readonly ctx: Context) {
    this.ready = this.store.open(ctx.storageDomain)
    ctx.effect(() => async () => {
      await this.ready.catch(() => undefined)
      try {
        await this.flush()
      } finally {
        await this.store.close()
      }
    }, 'session-controller.attention')
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      const pending = this.promptTail.then(async () => {
        await this.ready
        const attention = await this.store.notePrompt(session.id, event.seq)
        ctx.emit('api-session/attention', session.id, attention)
      })
      this.promptTail = pending.catch(error => {
        this.promptFailure = { error }
        ctx.logger.error(`api-session.attention: failed to persist prompt watermark for "${session.id}": ${String(error)}`)
      })
    })
    ctx.on('session/flush', () => this.flush())
  }

  summary(sessionId: SessionId): SessionAttentionSummary | null {
    return this.store.summary(sessionId)
  }

  async reconcile(sessionId: SessionId, signal?: AbortSignal): Promise<SessionAttentionSummary | null> {
    await this.ready
    signal?.throwIfAborted()
    const expectedCursor = this.store.reconciliationCursor(sessionId)
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined && attached.seq - 1 === expectedCursor) {
      return this.store.summary(sessionId)
    }

    const observation = await this.ctx.sessionQuery.observeSession(sessionId, {
      ...(signal === undefined ? {} : { signal }),
      projectionMode: 'none',
    })
    try {
      signal?.throwIfAborted()
      if (observation.cursor === expectedCursor) return this.store.summary(sessionId)
      const replace = observation.cursor < expectedCursor
      const promptSeqs = observation.events
        .filter(event => (replace || event.seq > expectedCursor)
          && event.type === 'user/message'
          && event.data.source.kind === 'user')
        .map(event => event.seq)
      const before = this.store.summary(sessionId)
      const attention = await this.store.reconcile(sessionId, expectedCursor, observation.cursor, promptSeqs)
      if (before?.lastPromptSeq !== attention.lastPromptSeq
        || before?.readThroughSeq !== attention.readThroughSeq
        || before?.snoozed !== attention.snoozed
        || before?.unread !== attention.unread) {
        this.ctx.emit('api-session/attention', sessionId, attention)
      }
      return attention
    } finally {
      observation[Symbol.dispose]()
    }
  }

  async flush(): Promise<void> {
    await this.ready
    await this.promptTail
    if (this.promptFailure !== undefined) throw this.promptFailure.error
    await this.store.flush()
  }

  async update(
    request: SessionAttentionUpdateRequest,
    signal: AbortSignal,
  ): Promise<SessionAttentionSummary> {
    await this.ready
    signal.throwIfAborted()
    const parsed = sessionAttentionRequestSchema.safeParse(request)
    if (!parsed.success) {
      throw new RemoteError('gateway/bad-request', 'session attention update is malformed', {})
    }
    const sessionId = SessionId(parsed.data.sessionId)
    const throughSeq = await this.throughSeq(sessionId, signal)
    signal.throwIfAborted()
    const attention = parsed.data.action.type === 'mark-read'
      ? await this.store.markRead(sessionId, throughSeq)
      : await this.store.setSnoozed(sessionId, parsed.data.action.snoozed)
    this.ctx.emit('api-session/attention', sessionId, attention)
    return attention
  }

  private async throughSeq(sessionId: SessionId, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted()
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) return attached.seq - 1

    let observation: SessionObservation | undefined
    try {
      observation = await this.ctx.sessionQuery.observeSession(sessionId, { signal })
      signal.throwIfAborted()
      if (observation.header.cwd === undefined) {
        throw new RemoteError('session/not-found', 'session is not visible', { sessionId })
      }
      return observation.cursor
    } catch (error: unknown) {
      if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
        throw new RemoteError('session/not-found', `session "${sessionId}" does not exist`, { sessionId }, { cause: error })
      }
      if (signal.aborted || (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED')) {
        throw new RemoteError('gateway/cancelled', 'session attention update was cancelled', {}, { cause: error })
      }
      if (error instanceof RemoteError) throw error
      throw new RemoteError('gateway/internal', 'session attention update failed', {}, { cause: error })
    } finally {
      observation?.[Symbol.dispose]()
    }
  }
}
