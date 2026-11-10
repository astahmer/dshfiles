import { createHostApiClient } from '@dshfiles/dshx/host'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { publishLocalOtlpEndpoint } from '@dshfiles/dshx/tracing'
import { threadSidebarAttentionApi } from '@dshfiles/thread-sidebar/attention-api'
import { Effect, FiberHandle, Layer, Stream } from 'effect'
import { ThreadAttention, ThreadMarkFailed } from './alerts/alert-engine.js'
import { Receiver, type ListenStatus } from './receiver.js'

const OWNER = '@dshfiles/traces'
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]'])

/** The URL a client of this process dials: a wildcard listen address is reached on loopback. */
export const dialableEndpoint = (address: string, port: number | null): string | null => {
  if (port === null) return null
  const host = WILDCARD_HOSTS.has(address) ? '127.0.0.1' : address
  return `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${String(port)}`
}

const endpointOf = (status: ListenStatus): string | null => (status.state === 'listening' ? dialableEndpoint(status.address, status.boundPort) : null)

/** Thread attention goes through thread-sidebar's own contract; without it the alert still fires and says why no thread was marked. */
export const ThreadAttentionLive = Layer.effect(
  ThreadAttention,
  Effect.gen(function* () {
    const host = yield* HostContext
    const attention = Api.client({ contract: threadSidebarAttentionApi, api: createHostApiClient(host.ctx, threadSidebarAttentionApi, OWNER) })
    return ThreadAttention.of({
      mark: sessionId =>
        attention.markUnread({ sessionId }).pipe(
          Effect.as(true),
          Effect.catch(error =>
            error._tag === 'ApiUnavailableError' && error.ownerMissing
              ? Effect.succeed(false)
              : Effect.fail(new ThreadMarkFailed({ sessionId, reason: error.message, cause: error })),
          ),
        ),
    })
  }),
)

/** Publish the bound receiver to this process's exporters while it listens; withdraw it otherwise. */
export const LocalEndpointLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const receiver = yield* Receiver
    const published = yield* FiberHandle.make()
    const publish = (baseUrl: string) =>
      Effect.acquireRelease(
        Effect.sync(() => publishLocalOtlpEndpoint({ baseUrl, owner: OWNER })),
        withdraw => Effect.sync(withdraw),
      ).pipe(Effect.andThen(Effect.never), Effect.scoped)
    yield* DshxPlugin.worker(
      receiver.changes.pipe(
        Stream.map(endpointOf),
        Stream.changes,
        Stream.runForEach(endpoint =>
          Effect.andThen(FiberHandle.clear(published), endpoint === null ? Effect.void : FiberHandle.run(published, publish(endpoint))),
        ),
      ),
    )
  }),
)
