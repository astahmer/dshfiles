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
import { Context, Effect, Layer, Option, Schema } from 'effect'

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

export class SessionSourceRegistryError extends Schema.TaggedError<SessionSourceRegistryError>()('SessionSourceRegistryError', {
  operation: Schema.Literals(['resolve-owner']),
}) {}

export class SessionSources extends Context.Service<
  SessionSources,
  {
    register(source: MirroredSessionSource): Effect.Effect<() => void>
    sources(): Effect.Effect<readonly MirroredSessionSource[]>
    claim(source: MirroredSessionSource, sessionIds: readonly SessionId[]): Effect.Effect<void>
    ownerOf(sessionId: string): Effect.Effect<MirroredSessionSource | undefined>
    resolveOwner(sessionId: SessionId): Effect.Effect<MirroredSessionSource | undefined, SessionSourceRegistryError>
  }
>()('@dshfiles/session-source-port/SessionSources') {
  static layer(registry: SessionSourceRegistry) {
    return Layer.succeed(
      SessionSources,
      SessionSources.of({
        register: source => Effect.sync(() => registry.register(source)),
        sources: () => Effect.sync(() => registry.sources()),
        claim: (source, sessionIds) => Effect.sync(() => registry.claim(source, sessionIds)),
        ownerOf: sessionId => Effect.sync(() => registry.ownerOf(sessionId)),
        resolveOwner: sessionId =>
          Effect.tryPromise({
            try: () => registry.resolveOwner(sessionId),
            catch: () => new SessionSourceRegistryError({ operation: 'resolve-owner' }),
          }),
      }),
    )
  }
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

const boundedString = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
/** One runtime's payload keeps every field it sent; only the fields this Host reads are named. */
const passthrough = <Shape extends Schema.StructWithRest.Objects>(shape: Shape) => Schema.StructWithRest(shape, [Schema.Record(Schema.String, Schema.Unknown)])
/** Check an unknown wire payload against its shape and hand it back with the wire type it already has. */
const wirePayload = <Wire>(shape: Schema.ConstraintDecoder<unknown>) =>
  Schema.declare<Wire>((value): value is Wire => Option.isSome(Schema.decodeUnknownOption(shape)(value)))

const sessionSummaryShape = passthrough(
  Schema.Struct({
    sessionId: boundedString(1, 256),
    updatedAt: Schema.Number,
    running: Schema.Boolean,
    blank: Schema.Boolean,
    agentAvailable: Schema.Boolean,
    cwd: Schema.optionalKey(Schema.String),
    parentSessionId: Schema.optionalKey(Schema.String),
    origin: Schema.optionalKey(Schema.Literal('subagent')),
    formatStatus: Schema.optionalKey(Schema.Literals(['current', 'migration-required'])),
    projections: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
)
const sessionSummarySchema = wirePayload<SessionSummary>(sessionSummaryShape)
const sessionFollowFrameSchema = wirePayload<SessionFollowFrame>(
  passthrough(Schema.Struct({ type: Schema.Literals(['snapshot', 'event', 'assistant-stream']) })),
)
const sessionPageSchema = wirePayload<SessionPage>(
  passthrough(Schema.Struct({ records: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(10_000)), hasMore: Schema.Boolean })),
)
const acceptedShape = passthrough(Schema.Struct({ accepted: Schema.Literal(true) }))
const sessionPromptValueSchema = wirePayload<SessionPromptValue>(acceptedShape)
const sessionCancelValueSchema = wirePayload<SessionCancelValue>(acceptedShape)
const sessionUpdateQueueValueSchema = wirePayload<SessionUpdateQueueValue>(acceptedShape)
const modelSelectionShape = passthrough(
  Schema.Struct({ provider: Schema.String, model: Schema.String, reasoningEffort: Schema.optionalKey(Schema.String) }),
)
const sessionSelectModelValueSchema = wirePayload<SessionSelectModelValue>(passthrough(Schema.Struct({ selected: modelSelectionShape })))
const projectionsShape = Schema.Union([
  Schema.Null,
  passthrough(Schema.Struct({ kind: Schema.Literal('sequenced'), asOfSeq: Schema.Number })),
  passthrough(Schema.Struct({ kind: Schema.Literal('migration-required') })),
])
const sessionProjectionsValueSchema = wirePayload<SessionProjectionsValue>(projectionsShape)

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
    return Schema.decodeUnknownSync(
      passthrough(Schema.Struct({ items: Schema.Array(sessionSummarySchema).check(Schema.isMaxLength(10_000)) })),
    )(value).items
  }

  /**
   * One frame of a runtime's `session/follow` stream. The frame was produced by a DSH Host's own encoder, so only its
   * discriminant is checked here and the browser validates the events it renders.
   * @param value - one stream item.
   * @returns the same frame typed for the Session wire.
   */
  static followFrame(value: unknown): SessionFollowFrame {
    return Schema.decodeUnknownSync(sessionFollowFrameSchema)(value)
  }

  /**
   * One history page of a runtime's `session/page` answer.
   * @param value - the runtime's `SessionPage`.
   * @returns the page typed for the Session wire.
   */
  static page(value: unknown): SessionPage {
    return Schema.decodeUnknownSync(sessionPageSchema)(value)
  }

  /**
   * One runtime's `session/projections` answer.
   * @param value - the runtime's `SessionProjectionsValue`.
   * @returns the same value typed for the Session wire.
   */
  static projections(value: unknown): SessionProjectionsValue {
    return Schema.decodeUnknownSync(sessionProjectionsValueSchema)(value)
  }

  /** Decode an admitted prompt receipt. */
  static prompt(value: unknown): SessionPromptValue {
    return Schema.decodeUnknownSync(sessionPromptValueSchema)(value)
  }

  /** Decode an admitted cancellation receipt. */
  static cancel(value: unknown): SessionCancelValue {
    return Schema.decodeUnknownSync(sessionCancelValueSchema)(value)
  }

  /** Decode the selected model accepted by a remote Session's runtime. */
  static selectedModel(value: unknown): SessionSelectModelValue {
    return Schema.decodeUnknownSync(sessionSelectModelValueSchema)(value)
  }

  /** Decode an applied queue mutation receipt. */
  static queue(value: unknown): SessionUpdateQueueValue {
    return Schema.decodeUnknownSync(sessionUpdateQueueValueSchema)(value)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Sessions that live on another runtime, answered through this Host. */
    sessionSources: SessionSourceRegistry
  }
}
