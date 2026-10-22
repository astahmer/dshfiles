import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSessionSourceRegistry, type MirroredSessionSource, type SessionSourceRegistry } from '@dshfiles/session-source-port'
import type {
  SessionAddress,
  SessionCancelRequest,
  SessionCancelValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionListRequest,
  SessionPage,
  SessionPageRequest,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionSummary,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from './native/types.ts'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The Session one address names; a subagent address has no Session of its own to mirror. */
const addressedSessionId = (address: SessionAddress): SessionId | undefined => (address.kind === 'session' ? address.sessionId : undefined)

/**
 * Sessions that live on another runtime, answered through this Host: one place where the `session/*` endpoints decide
 * between this Host's registry and a registered source.
 *
 * A source owns a Session by claiming it from a `list` answer, so a control flow never walks every source for a Session
 * this Host owns. Every endpoint keeps a local fallback: when no source answers, the caller's own implementation runs
 * unchanged. Writes keep their ownership — the runtime that owns the Session admits the prompt — and the mirror never
 * writes a remote log.
 */
export class MirroredSessions {
  readonly registry: SessionSourceRegistry = createSessionSourceRegistry()
  private readonly published = new Map<string, { readonly running: boolean }>()

  /** @param ctx - Host context used to publish list and status changes to the browser. */
  constructor(private readonly ctx: Context) {}

  /** Publish the registry other plugins register their sources into. */
  provide(): void {
    this.ctx.provide('sessionSources', this.registry)
  }

  /** A Session this Host has attached belongs to this runtime, not to a source. */
  private isLocal(sessionId: SessionId): boolean {
    return this.ctx.sessions.get(sessionId) !== undefined
  }

  /** The source that already claimed this Session, without any I/O. */
  ownerOf(sessionId: SessionId): MirroredSessionSource | undefined {
    return this.registry.ownerOf(sessionId)
  }

  /** Resolve the source that answers for this Session, or nothing when this Host owns it. */
  private async resolve(sessionId: SessionId): Promise<MirroredSessionSource | undefined> {
    if (this.isLocal(sessionId)) return undefined
    const claimed = this.registry.ownerOf(sessionId)
    if (claimed !== undefined) return claimed
    return this.registry.resolveOwner(sessionId)
  }

  private async require(sessionId: SessionId, endpoint: string): Promise<MirroredSessionSource> {
    const source = await this.resolve(sessionId)
    if (source !== undefined) return source
    throw new RemoteError('gateway/bad-request', `No runtime answers ${endpoint} for Session ${sessionId}.`, {})
  }

  /** Wrap a source failure so the browser gets a stable code instead of a transport error. */
  static failure(endpoint: string, error: unknown): RemoteError {
    if (error instanceof RemoteError) return error
    return new RemoteError('gateway/internal', `The runtime that owns this Session did not answer ${endpoint}: ${messageOf(error)}`, {}, { cause: error })
  }

  /**
   * Merge every source's rows into this Host's list. One unreachable runtime never hides the local threads, and every
   * new or changed row is published so an open browser picks it up without waiting for its next pull.
   * @param local - rows this Host already built.
   * @param request - the caller's request, forwarded to each source.
   * @param signal - caller cancellation.
   * @returns local rows followed by mirrored rows, newest activity first.
   */
  async merge(local: readonly SessionSummary[], request: SessionListRequest, signal: AbortSignal): Promise<readonly SessionSummary[]> {
    const merged: SessionSummary[] = [...local]
    const known = new Set(local.map(item => String(item.sessionId)))
    for (const source of this.registry.sources()) {
      let rows: readonly SessionSummary[]
      try {
        rows = await source.list(request, signal)
      } catch {
        continue
      }
      if (rows.length === 0) continue
      this.registry.claim(
        source,
        rows.map(row => row.sessionId),
      )
      for (const row of rows) {
        const key = String(row.sessionId)
        if (known.has(key)) continue
        known.add(key)
        merged.push(row)
        this.publish(row)
      }
    }
    return merged.sort((left, right) => right.updatedAt - left.updatedAt)
  }

  /** Announce a newly listed mirrored Session, and a changed running state, to the browser. */
  private publish(row: SessionSummary): void {
    const key = String(row.sessionId)
    const previous = this.published.get(key)
    this.published.set(key, { running: row.running })
    if (previous === undefined) {
      this.ctx.emit('api-session/added', row)
      return
    }
    if (previous.running !== row.running) this.ctx.emit('api-session/status', row.sessionId, row.running)
  }

  /**
   * Follow a mirrored Session's own stream, or the local history when no source owns it.
   * @param request - the caller's follow request, forwarded unchanged.
   * @param signal - caller cancellation.
   * @param local - this Host's own implementation.
   * @returns the same frames the owning runtime emits.
   */
  async *follow(
    request: SessionFollowRequest,
    signal: AbortSignal,
    local: (request: SessionFollowRequest, signal: AbortSignal) => AsyncIterable<SessionFollowFrame>,
  ): AsyncIterable<SessionFollowFrame> {
    const sessionId = addressedSessionId(request.address)
    const source = sessionId === undefined ? undefined : await this.resolve(sessionId)
    if (source === undefined) {
      yield* local(request, signal)
      return
    }
    if (source.follow === undefined) throw new RemoteError('gateway/bad-request', 'This runtime cannot stream that Session.', {})
    try {
      yield* source.follow(request, signal)
    } catch (error) {
      throw MirroredSessions.failure('session/follow', error)
    }
  }

  /**
   * Page a mirrored Session, or the local history when no source owns it.
   * @param request - the caller's page request, forwarded unchanged.
   * @param signal - caller cancellation.
   * @param local - this Host's own implementation.
   * @returns the owning runtime's page.
   */
  async page(
    request: SessionPageRequest,
    signal: AbortSignal,
    local: (request: SessionPageRequest, signal: AbortSignal) => Promise<SessionPage>,
  ): Promise<SessionPage> {
    const sessionId = addressedSessionId(request.address)
    const source = sessionId === undefined ? undefined : await this.resolve(sessionId)
    if (source === undefined) return local(request, signal)
    if (source.page === undefined) throw new RemoteError('gateway/bad-request', 'This runtime cannot page that Session.', {})
    try {
      return await source.page(request, signal)
    } catch (error) {
      throw MirroredSessions.failure('session/page', error)
    }
  }

  /**
   * Admit a prompt in the runtime that owns the Session.
   * @param request - the caller's prompt, forwarded unchanged.
   * @param signal - caller cancellation.
   * @param local - this Host's own implementation.
   * @returns the owning runtime's admission receipt.
   */
  async prompt(
    request: SessionPromptRequest,
    signal: AbortSignal,
    local: (request: SessionPromptRequest, signal: AbortSignal) => Promise<SessionPromptValue>,
  ): Promise<SessionPromptValue> {
    const source = await this.resolve(request.sessionId)
    if (source === undefined) return local(request, signal)
    if (source.prompt === undefined) throw new RemoteError('gateway/bad-request', 'This runtime cannot receive that message.', {})
    try {
      return await source.prompt(request, signal)
    } catch (error) {
      throw MirroredSessions.failure('session/prompt', error)
    }
  }

  /**
   * Cancel a mirrored Session's turn, or the local one.
   * @param request - the caller's cancellation.
   * @param local - this Host's own implementation.
   * @returns the owning runtime's receipt.
   */
  async cancel(
    request: SessionCancelRequest,
    local: (request: SessionCancelRequest) => Promise<SessionCancelValue> | SessionCancelValue,
  ): Promise<SessionCancelValue> {
    const source = await this.resolve(request.sessionId)
    if (source === undefined) return local(request)
    if (source.cancel === undefined) throw new RemoteError('gateway/bad-request', 'This runtime cannot stop that turn.', {})
    try {
      return await source.cancel(request)
    } catch (error) {
      throw MirroredSessions.failure('session/cancel', error)
    }
  }

  /**
   * Apply one queue mutation in the runtime that owns the Session.
   * @param request - the caller's mutation, forwarded unchanged.
   * @param local - this Host's own implementation.
   * @returns the owning runtime's receipt.
   */
  async updateQueue(
    request: SessionUpdateQueueRequest,
    local: (request: SessionUpdateQueueRequest) => Promise<SessionUpdateQueueValue>,
  ): Promise<SessionUpdateQueueValue> {
    const source = await this.resolve(request.sessionId)
    if (source === undefined) return local(request)
    if (source.updateQueue === undefined) {
      throw new RemoteError('gateway/bad-request', 'This runtime cannot edit that queue.', {})
    }
    try {
      return await source.updateQueue(request)
    } catch (error) {
      throw MirroredSessions.failure('session/updateQueue', error)
    }
  }

  /**
   * Read a mirrored Session's projections, or this Host's.
   * @param request - the caller's request, forwarded unchanged.
   * @param signal - caller cancellation.
   * @param local - this Host's own implementation.
   * @returns the owning runtime's projections.
   */
  async projections(
    request: SessionProjectionsRequest,
    signal: AbortSignal,
    local: (request: SessionProjectionsRequest, signal: AbortSignal) => Promise<SessionProjectionsValue>,
  ): Promise<SessionProjectionsValue> {
    const source = await this.resolve(request.sessionId)
    if (source === undefined) return local(request, signal)
    if (source.projections === undefined) {
      throw new RemoteError('gateway/bad-request', 'This runtime cannot report that Session.', {})
    }
    try {
      return await source.projections(request, signal)
    } catch (error) {
      throw MirroredSessions.failure('session/projections', error)
    }
  }

  async selectModel(
    request: SessionSelectModelRequest,
    local: (request: SessionSelectModelRequest) => Promise<SessionSelectModelValue>,
  ): Promise<SessionSelectModelValue> {
    const source = await this.resolve(request.sessionId)
    if (source === undefined) return local(request)
    if (source.selectModel === undefined) throw new RemoteError('gateway/bad-request', 'This runtime cannot select a model for that Session.', {})
    try {
      return await source.selectModel(request)
    } catch (error) {
      throw MirroredSessions.failure('session/selectModel', error)
    }
  }
}
