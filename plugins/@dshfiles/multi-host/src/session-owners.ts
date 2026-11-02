import type { SessionSourceRegistry } from '@dshfiles/session-source-port'
import { Context, Effect, Layer, Option, Ref, Stream } from 'effect'
import { HostContext, hostServiceChanges } from '@dshfiles/dshx/effect'
import { authorizeVia, knownRuntimeOf } from './session-registry-promise.js'

/** What the Host's Session controller says about a Session: the runtime that owns it, or why it refuses a route. */
export class SessionOwners extends Context.Service<
  SessionOwners,
  {
    /** The registry the Host's Session controller publishes, while it publishes one. */
    readonly registry: Effect.Effect<Option.Option<SessionSourceRegistry>>
    /** Changes of that availability, so a source can register for exactly as long as the registry exists. */
    readonly changes: Effect.Effect<Stream.Stream<Option.Option<SessionSourceRegistry>>, never, HostContext>
    /** The runtime a registry already claims for this Session; a Session no source claims is not looked up. */
    readonly knownRuntime: (sessionId: string) => Effect.Effect<string | null>
    /** Whether the runtime that owns this Session is `runtimeId`. */
    readonly authorize: (input: {
      readonly sessionId: string
      readonly runtimeId: string
      readonly recordedSessions: readonly { readonly sessionId: string; readonly runtimeId: string }[]
    }) => Effect.Effect<{ readonly ok: true } | { readonly ok: false; readonly code: 'session/not-remote' | 'session/wrong-runtime'; readonly message: string }>
  }
>()('@dshfiles/multi-host/SessionOwners') {
  static readonly layer = Layer.effect(
    SessionOwners,
    Effect.gen(function* () {
      const host = yield* HostContext
      const current = yield* Ref.make<Option.Option<SessionSourceRegistry>>(Option.fromUndefinedOr(host.ctx.get('sessionSources')))

      const registries = Effect.map(Ref.get(current), available => (Option.isSome(available) ? [available.value] : []))

      const changes = hostServiceChanges('sessionSources')
      // Track the registry as the Host provides and withdraws it; the plugin starts without one.
      yield* Stream.runForEach(Stream.unwrap(changes), available => Ref.set(current, available)).pipe(Effect.forkScoped)

      const knownRuntime = (sessionId: string) =>
        Effect.flatMap(registries, sources => (sources.length === 0 ? Effect.succeed(null) : knownRuntimeOf({ sessionId, registries: sources })))

      const authorize = (input: {
        readonly sessionId: string
        readonly runtimeId: string
        readonly recordedSessions: readonly { readonly sessionId: string; readonly runtimeId: string }[]
      }) =>
        Effect.flatMap(registries, sources =>
          authorizeVia({ sessionId: input.sessionId, runtimeId: input.runtimeId, recordedSessions: input.recordedSessions, registries: sources }),
        )

      return SessionOwners.of({ registry: Ref.get(current), changes, knownRuntime, authorize })
    }),
  )
}
