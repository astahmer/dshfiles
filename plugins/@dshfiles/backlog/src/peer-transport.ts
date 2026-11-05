import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { multiHostApi } from '@dshfiles/multi-host/api'
import { Context, Effect, Layer, Schema } from 'effect'

/** The backlog reads a peer may ask another Host for; `@dshfiles/multi-host` allowlists exactly these. */
export type PeerRead = 'backlog/peerInfo' | 'backlog/peerOpsSince' | 'backlog/peerFiles'

/** A multi-host runtime this Host could replicate the backlog with. */
export interface PeerRuntime {
  readonly runtimeId: string
  readonly name: string
  readonly connected: boolean
}

/** A peer read that did not answer: `code` is the runtime's or the remote plugin's own failure code. */
export class PeerCallFailed extends Schema.TaggedError<PeerCallFailed>()('PeerCallFailed', {
  code: Schema.String.check(Schema.isMaxLength(128)),
  detail: Schema.String.check(Schema.isMaxLength(1_000)),
}) {
  override get message(): string {
    return this.detail
  }
}

const unavailable = (detail: string) => new PeerCallFailed({ code: 'multi-host-unavailable', detail: detail.slice(0, 1_000) })

/**
 * How the backlog reaches other Hosts: the multi-host runtimes it can see and one allowlisted read on one of them. The
 * live layer goes through `@dshfiles/multi-host`'s published contract; tests wire Hosts to each other directly.
 */
export class PeerTransport extends Context.Service<
  PeerTransport,
  {
    /** Whether `@dshfiles/multi-host` is loaded; without it there are no peers and nothing pulls. */
    readonly available: Effect.Effect<boolean>
    readonly runtimes: Effect.Effect<readonly PeerRuntime[], PeerCallFailed>
    readonly read: (input: { readonly runtimeId: string; readonly call: PeerRead; readonly input: Schema.Json }) => Effect.Effect<unknown, PeerCallFailed>
  }
>()('@dshfiles/backlog/PeerTransport') {
  static readonly layer = Layer.effect(
    PeerTransport,
    Effect.gen(function* () {
      const apis = yield* HostApis
      const multiHost = apis.typed(multiHostApi)
      return PeerTransport.of({
        available: apis.isServed(multiHostApi),
        runtimes: multiHost.list().pipe(
          Effect.map(listed => listed.runtimes.map(runtime => ({ runtimeId: runtime.id, name: runtime.name, connected: runtime.connected }))),
          Effect.mapError(error => unavailable(error.message)),
        ),
        read: input =>
          multiHost.runtimePeerRead({ runtimeId: input.runtimeId, call: input.call, input: input.input }).pipe(
            Effect.mapError(error => unavailable(error.message)),
            Effect.flatMap(result =>
              result.ok
                ? Effect.succeed(result.value)
                : Effect.fail(new PeerCallFailed({ code: result.code.slice(0, 128), detail: result.message.slice(0, 1_000) })),
            ),
          ),
      })
    }),
  )

  /** Peers answered in-process: each runtime id names a function serving the three reads, so Hosts in one test pull from each other. */
  static readonly layerTest = (
    network: ReadonlyMap<string, { readonly name: string; readonly serve: (call: PeerRead, input: Schema.Json) => Effect.Effect<unknown, PeerCallFailed> }>,
  ) =>
    Layer.succeed(
      PeerTransport,
      PeerTransport.of({
        available: Effect.succeed(true),
        runtimes: Effect.sync(() => [...network].map(([runtimeId, peer]) => ({ runtimeId, name: peer.name, connected: true }))),
        read: input =>
          Effect.suspend(() => {
            const peer = network.get(input.runtimeId)
            return peer === undefined
              ? Effect.fail(new PeerCallFailed({ code: 'runtime-not-found', detail: 'No such runtime.' }))
              : peer.serve(input.call, input.input)
          }),
      }),
    )

  /** No multi-host plugin: nothing to pull from. */
  static readonly layerAbsent = Layer.succeed(
    PeerTransport,
    PeerTransport.of({
      available: Effect.succeed(false),
      runtimes: Effect.succeed([]),
      read: () => Effect.fail(unavailable('Multi-host is not loaded.')),
    }),
  )
}
