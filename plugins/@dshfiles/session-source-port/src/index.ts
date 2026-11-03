import type {} from '@deepseek-ai/cordis'
import type {
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
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import * as SessionPayload from './payload.ts'

export { SessionSourceRegistryError, SessionSources, type EffectSessionSource } from './effect.ts'
export { fromEffect } from './session-source-promise.ts'
export * as SessionPayload from './payload.ts'
export { SessionPayloadError } from './payload.ts'

/**
 * One place where Sessions live other than this Host — a DSH runtime reached through a tunnel, or anything else that can
 * answer the Session wire calls. The Session controller asks its sources before its own registry, so a mirrored Session
 * opens in the same chat and composer as a local one while its events stay on the runtime that owns them.
 *
 * Every method mirrors one `session/*` endpoint: the controller forwards the request it received and returns the answer
 * unchanged. A missing method makes that endpoint local-only, so a source can start read-only and gain writes later.
 */
export interface MirroredSessionSource {
  /** Stable source identity, e.g. the runtime id. */
  readonly id: string
  /** Display name, e.g. the host name. */
  readonly label: string
  /** Sessions this source can answer for right now; the same rows `session/list` would return. */
  list(request: SessionListRequest, signal: AbortSignal): Promise<readonly SessionSummary[]>
  /** Cheap ownership test used when a Session id is not in the claim cache yet. */
  owns(sessionId: SessionId): boolean | Promise<boolean>
  /** Optional runtime identity for capabilities that must execute on the owning Host. */
  runtimeIdForSession?(sessionId: string): Promise<string | undefined>
  follow?(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame>
  page?(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage>
  prompt?(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue>
  cancel?(request: SessionCancelRequest): SessionCancelValue | Promise<SessionCancelValue>
  updateQueue?(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue>
  projections?(request: SessionProjectionsRequest, signal: AbortSignal): Promise<SessionProjectionsValue>
  selectModel?(request: SessionSelectModelRequest): Promise<SessionSelectModelValue>
}

/** The registry the Session controller provides as `sessionSources`. */
export interface SessionSourceRegistry {
  /** Add one source; the returned function removes it and forgets its claims. */
  register(source: MirroredSessionSource): () => void
  /** Sources in registration order. */
  sources(): readonly MirroredSessionSource[]
  /** Record that these Sessions belong to that source, e.g. from a `list` answer. */
  claim(source: MirroredSessionSource, sessionIds: readonly SessionId[]): void
  /** The source that claimed this Session, without any I/O. */
  ownerOf(sessionId: string): MirroredSessionSource | undefined
  /** The claiming source, asking every source's cheap `owns` when nothing is cached. */
  resolveOwner(sessionId: SessionId): Promise<MirroredSessionSource | undefined>
}

/**
 * Create the registry the Session controller provides.
 * @returns an empty registry whose claims follow its registered sources.
 */
export const createSessionSourceRegistry = (): SessionSourceRegistry => {
  const registered: MirroredSessionSource[] = []
  const claims = new Map<string, MirroredSessionSource>()
  const registeredSources = (): readonly MirroredSessionSource[] => [...registered]
  const forget = (source: MirroredSessionSource): void => {
    for (const [sessionId, owner] of claims) if (owner === source) claims.delete(sessionId)
  }
  return {
    register: source => {
      if (!registered.includes(source)) registered.push(source)
      return () => {
        const index = registered.indexOf(source)
        if (index !== -1) registered.splice(index, 1)
        forget(source)
      }
    },
    sources: registeredSources,
    claim: (source, sessionIds) => {
      for (const sessionId of sessionIds) claims.set(sessionId, source)
    },
    ownerOf: sessionId => claims.get(sessionId),
    resolveOwner: async sessionId => {
      const cached = claims.get(sessionId)
      if (cached !== undefined && registered.includes(cached)) return cached
      if (cached !== undefined) claims.delete(sessionId)
      for (const source of registeredSources()) {
        if (!(await source.owns(sessionId))) continue
        claims.set(sessionId, source)
        return source
      }
      return undefined
    },
  }
}

/**
 * Synchronous decoders for Host code that is not Effect yet; each throws the `SessionPayloadError` that the matching
 * `SessionPayload` Effect decoder fails with.
 */
export class SessionSourcePayload {
  static summaries(value: unknown): readonly SessionSummary[] {
    return SessionPayload.summaries.sync(value)
  }

  static followFrame(value: unknown): SessionFollowFrame {
    return SessionPayload.followFrame.sync(value)
  }

  static page(value: unknown): SessionPage {
    return SessionPayload.page.sync(value)
  }

  static projections(value: unknown): SessionProjectionsValue {
    return SessionPayload.projections.sync(value)
  }

  static prompt(value: unknown): SessionPromptValue {
    return SessionPayload.prompt.sync(value)
  }

  static cancel(value: unknown): SessionCancelValue {
    return SessionPayload.cancel.sync(value)
  }

  static selectedModel(value: unknown): SessionSelectModelValue {
    return SessionPayload.selectedModel.sync(value)
  }

  static queue(value: unknown): SessionUpdateQueueValue {
    return SessionPayload.queue.sync(value)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Sessions that live on another runtime, answered through this Host. */
    sessionSources: SessionSourceRegistry
  }
}
