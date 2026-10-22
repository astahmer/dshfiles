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
import { z } from 'zod'

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

const sessionSummaryShape = z
  .object({
    sessionId: z.string().min(1).max(256),
    updatedAt: z.number(),
    running: z.boolean(),
    blank: z.boolean(),
    agentAvailable: z.boolean(),
    cwd: z.string().optional(),
    parentSessionId: z.string().optional(),
    origin: z.literal('subagent').optional(),
    formatStatus: z.enum(['current', 'migration-required']).optional(),
    projections: z.object({}).passthrough().optional(),
  })
  .passthrough()
const sessionFollowFrameShape = z.object({ type: z.enum(['snapshot', 'event', 'assistant-stream']) }).passthrough()
const sessionPageShape = z.object({ records: z.array(z.unknown()).max(10_000), hasMore: z.boolean() }).passthrough()
const acceptedShape = z.object({ accepted: z.literal(true) }).passthrough()
const modelSelectionShape = z.object({ provider: z.string(), model: z.string(), reasoningEffort: z.string().optional() }).passthrough()
const projectionsShape = z.union([
  z.null(),
  z.object({ kind: z.literal('sequenced'), asOfSeq: z.number() }).passthrough(),
  z.object({ kind: z.literal('migration-required') }).passthrough(),
])

/**
 * Decoders for the payloads a remote runtime answers with. Each one validates the fields this Host or the browser
 * actually reads at the JSON boundary and then declares the wire type, so no caller casts an `unknown` further.
 */
export class SessionSourcePayload {
  /**
   * Rows of one runtime's `session/list` answer.
   * @param value - the runtime's `SessionListValue`.
   * @returns the rows the browser's Session model reads.
   */
  static summaries(value: unknown): readonly SessionSummary[] {
    return z
      .object({ items: z.array(z.custom<SessionSummary>(row => sessionSummaryShape.safeParse(row).success)).max(10_000) })
      .passthrough()
      .parse(value).items
  }

  /**
   * One frame of a runtime's `session/follow` stream. The frame was produced by a DSH Host's own encoder, so only its
   * discriminant is checked here and the browser validates the events it renders.
   * @param value - one stream item.
   * @returns the same frame typed for the Session wire.
   */
  static followFrame(value: unknown): SessionFollowFrame {
    return z.custom<SessionFollowFrame>(frame => sessionFollowFrameShape.safeParse(frame).success).parse(value)
  }

  /**
   * One history page of a runtime's `session/page` answer.
   * @param value - the runtime's `SessionPage`.
   * @returns the page typed for the Session wire.
   */
  static page(value: unknown): SessionPage {
    return z.custom<SessionPage>(page => sessionPageShape.safeParse(page).success).parse(value)
  }

  /**
   * One runtime's `session/projections` answer.
   * @param value - the runtime's `SessionProjectionsValue`.
   * @returns the same value typed for the Session wire.
   */
  static projections(value: unknown): SessionProjectionsValue {
    return z.custom<SessionProjectionsValue>(answer => projectionsShape.safeParse(answer).success).parse(value)
  }

  /** Decode an admitted prompt receipt. */
  static prompt(value: unknown): SessionPromptValue {
    return acceptedShape.parse(value)
  }

  /** Decode an admitted cancellation receipt. */
  static cancel(value: unknown): SessionCancelValue {
    return acceptedShape.parse(value)
  }

  /** Decode the selected model accepted by a remote Session's runtime. */
  static selectedModel(value: unknown): SessionSelectModelValue {
    return z.custom<SessionSelectModelValue>(answer => z.object({ selected: modelSelectionShape }).passthrough().safeParse(answer).success).parse(value)
  }

  /** Decode an applied queue mutation receipt. */
  static queue(value: unknown): SessionUpdateQueueValue {
    return acceptedShape.parse(value)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Sessions that live on another runtime, answered through this Host. */
    sessionSources: SessionSourceRegistry
  }
}
