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
  readonly selectModel?: (request: SessionSelectModelRequest) => Effect.Effect<SessionSelectModelValue, unknown, R>
}

const aborted = (signal: AbortSignal) =>
  Effect.callback<void>(resume => {
    if (signal.aborted) return resume(Effect.void)
    const onAbort = () => resume(Effect.void)
    signal.addEventListener('abort', onAbort, { once: true })
    return Effect.sync(() => signal.removeEventListener('abort', onAbort))
  })

/**
 * Adapt an Effect source to the Promise/AsyncIterable port. The returned source runs every call with the services
 * of the Effect that built it; an aborted signal interrupts the call or ends the follow stream.
 */
export const fromEffect = <R>(source: EffectSessionSource<R>): Effect.Effect<MirroredSessionSource, never, R> =>
  Effect.map(Effect.context<R>(), context => {
    const run = Effect.runPromiseWith(context)
    const { follow, runtimeIdForSession, page, prompt, cancel, updateQueue, projections, selectModel } = source
    return {
      id: source.id,
      label: source.label,
      list: (request, signal) => run(source.list(request), { signal }),
      owns: sessionId => run(source.owns(sessionId)),
      ...(runtimeIdForSession !== undefined && {
        runtimeIdForSession: sessionId => run(Effect.map(runtimeIdForSession(sessionId), Option.getOrUndefined)),
      }),
      ...(follow !== undefined && {
        follow: (request, signal) => Stream.toAsyncIterableWith(Stream.interruptWhen(follow(request), aborted(signal)), context),
      }),
      ...(page !== undefined && { page: (request, signal) => run(page(request), { signal }) }),
      ...(prompt !== undefined && { prompt: (request, signal) => run(prompt(request), { signal }) }),
      ...(cancel !== undefined && { cancel: request => run(cancel(request)) }),
      ...(updateQueue !== undefined && { updateQueue: request => run(updateQueue(request)) }),
      ...(projections !== undefined && { projections: (request, signal) => run(projections(request), { signal }) }),
      ...(selectModel !== undefined && { selectModel: request => run(selectModel(request)) }),
    } satisfies MirroredSessionSource
  })
