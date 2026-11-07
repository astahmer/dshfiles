import type {
  SessionCancelRequest,
  SessionCancelValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionListRequest,
  SessionPage,
  SessionPageRequest,
  SessionProjectionsRequest,
  SessionProjectionsValue,
  SessionPromptRequest,
  SessionPromptValue,
  SessionForkRequest,
  SessionForkValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionSummary,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { hostService } from '@dshfiles/dshx/effect/host-context'
import { Context, Effect, Layer, Option, Schema, type Scope, Stream } from 'effect'
import type { MirroredSessionSource, SessionSourceRegistry } from './index.js'

export class SessionSourceRegistryError extends Schema.TaggedError<SessionSourceRegistryError>()('SessionSourceRegistryError', {
  operation: Schema.Literals(['resolve-owner']),
  sessionId: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Asking the session sources which one owns ${this.sessionId} failed.`
  }
}

/**
 * A source declined a message it will not forward. The text is written for the person at the composer, so the Session
 * controller shows it as it stands instead of reporting an unanswering runtime.
 */
export class SessionPromptRefused extends Schema.TaggedError<SessionPromptRefused>()('SessionPromptRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

const refusedShape = Schema.is(Schema.Struct({ _tag: Schema.Literal('SessionPromptRefused'), reason: Schema.String }))

/** Structural, because each bundle holds its own copy of the class. */
export const isSessionPromptRefused = (error: unknown): error is SessionPromptRefused => error instanceof Error && refusedShape(error)

/** The Session controller's registry of mirrored Session sources. */
export class SessionSources extends Context.Service<
  SessionSources,
  {
    /** Register `source` for the current Scope; it and its claims are removed when the Scope closes. */
    readonly register: (source: MirroredSessionSource) => Effect.Effect<void, never, Scope.Scope>
    readonly sources: Effect.Effect<readonly MirroredSessionSource[]>
    readonly claim: (source: MirroredSessionSource, sessionIds: readonly SessionId[]) => Effect.Effect<void>
    readonly ownerOf: (sessionId: string) => Effect.Effect<Option.Option<MirroredSessionSource>>
    readonly resolveOwner: (sessionId: SessionId) => Effect.Effect<Option.Option<MirroredSessionSource>, SessionSourceRegistryError>
  }
>()('@dshfiles/session-source-port/SessionSources') {
  /** The registry the Host's Session controller provides as `sessionSources`. */
  static readonly layer = Layer.effect(
    SessionSources,
    Effect.map(hostService('sessionSources'), registry => makeSessionSources(registry)),
  )

  /** A registry the caller owns, such as the one the Session controller creates. */
  static readonly fromRegistry = (registry: SessionSourceRegistry) => Layer.succeed(SessionSources, makeSessionSources(registry))
}

const makeSessionSources = (registry: SessionSourceRegistry) =>
  SessionSources.of({
    register: source =>
      Effect.acquireRelease(
        Effect.sync(() => registry.register(source)),
        unregister => Effect.sync(unregister),
      ).pipe(Effect.asVoid),
    sources: Effect.sync(() => registry.sources()),
    claim: (source, sessionIds) => Effect.sync(() => registry.claim(source, sessionIds)),
    ownerOf: sessionId => Effect.sync(() => Option.fromUndefinedOr(registry.ownerOf(sessionId))),
    resolveOwner: Effect.fn('session-source resolve-owner')(function* (sessionId) {
      const owner = yield* Effect.tryPromise({
        try: () => registry.resolveOwner(sessionId),
        catch: cause => new SessionSourceRegistryError({ operation: 'resolve-owner', sessionId, cause }),
      })
      return Option.fromUndefinedOr(owner)
    }),
  })

/** A mirrored Session source written with Effects; `fromEffect` turns it into the Promise port the controller calls. */
export interface EffectSessionSource<R = never> {
  readonly id: string
  readonly label: string
  readonly list: (request: SessionListRequest) => Effect.Effect<readonly SessionSummary[], unknown, R>
  readonly owns: (sessionId: SessionId) => Effect.Effect<boolean, unknown, R>
  readonly runtimeIdForSession?: (sessionId: string) => Effect.Effect<Option.Option<string>, unknown, R>
  readonly follow?: (request: SessionFollowRequest) => Stream.Stream<SessionFollowFrame, unknown, R>
  readonly page?: (request: SessionPageRequest) => Effect.Effect<SessionPage, unknown, R>
  readonly prompt?: (request: SessionPromptRequest) => Effect.Effect<SessionPromptValue, unknown, R>
  readonly cancel?: (request: SessionCancelRequest) => Effect.Effect<SessionCancelValue, unknown, R>
  readonly updateQueue?: (request: SessionUpdateQueueRequest) => Effect.Effect<SessionUpdateQueueValue, unknown, R>
  readonly projections?: (request: SessionProjectionsRequest) => Effect.Effect<SessionProjectionsValue, unknown, R>
  readonly fork?: (request: SessionForkRequest) => Effect.Effect<SessionForkValue, unknown, R>
  readonly rename?: (request: SessionRenameRequest) => Effect.Effect<SessionRenameValue, unknown, R>
  readonly selectModel?: (request: SessionSelectModelRequest) => Effect.Effect<SessionSelectModelValue, unknown, R>
}
