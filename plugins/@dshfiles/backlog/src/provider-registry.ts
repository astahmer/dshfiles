import type { Api } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Clock, Context, Effect, Layer, Ref } from 'effect'
import { BacklogProviderFailed, BacklogProviders, type BacklogProvider, type BacklogProviderMethods, type ProviderDescriptor } from './provider-port.js'
import { SyncProviderUnknown } from './sync-errors.js'

const OWNER = '@dshfiles/backlog'
const DESCRIBE_TTL_MS = 60_000

/** A client of one plugin's `backlog-provider` API: its own `BacklogProviderFailed` comes back whole, code and status included. */
export type ExternalProviderClient = Api.TypedApiClient<BacklogProviderMethods, BacklogProviderFailed>

/** One plugin serving the `backlog-provider` API, with a client to call it. */
export interface ExternalProviderEndpoint {
  readonly owner: string
  readonly client: ExternalProviderClient
}

/** Where external providers come from: every served `backlog-provider` API but the backlog's own. Injectable for tests. */
export class ExternalProviderEndpoints extends Context.Service<
  ExternalProviderEndpoints,
  { readonly list: Effect.Effect<readonly ExternalProviderEndpoint[]> }
>()('@dshfiles/backlog/ExternalProviderEndpoints') {
  static readonly layer = Layer.effect(
    ExternalProviderEndpoints,
    Effect.gen(function* () {
      const apis = yield* HostApis
      return ExternalProviderEndpoints.of({
        list: Effect.map(apis.list, listed =>
          listed
            .filter(api => api.id === BacklogProviders.apiId && api.owner !== OWNER)
            .map(api => ({ owner: api.owner, client: apis.typed(BacklogProviders.contract(api.owner), { errors: [BacklogProviderFailed] }) })),
        ).pipe(Effect.withSpan('backlog providers list')),
      })
    }),
  )

  static readonly layerTest = (endpoints: readonly ExternalProviderEndpoint[]) =>
    Layer.succeed(ExternalProviderEndpoints, ExternalProviderEndpoints.of({ list: Effect.succeed(endpoints) }))
}

/**
 * A failed wire call as a provider failure. The provider's own `BacklogProviderFailed` arrives decoded, with its code
 * and status, and passes through; only a call that never reached it (transport, owner unloaded, contract mismatch) or
 * a failure it did not declare is classified here.
 */
const failureOf =
  (label: string) =>
  (error: BacklogProviderFailed | Api.ApiCallFailure): BacklogProviderFailed => {
    switch (error._tag) {
      case 'BacklogProviderFailed':
        return error
      case 'ApiTransportError':
      case 'ApiUnavailableError':
        return new BacklogProviderFailed({ provider: label, code: 'transport', detail: error.message.slice(0, 300) })
      case 'ApiContractError':
        return new BacklogProviderFailed({ provider: label, code: 'unsupported', detail: error.message.slice(0, 300) })
      case 'ApiRemoteError':
        return new BacklogProviderFailed({ provider: label, code: 'rejected', detail: error.message.slice(0, 300) })
    }
  }

/** An external provider kind behind the same in-process interface the built-ins implement. */
const adapt = (descriptor: ProviderDescriptor, client: ExternalProviderClient): BacklogProvider => {
  const fail = failureOf(descriptor.label)
  return {
    descriptor,
    identity: connection => client.identity({ connection }).pipe(Effect.mapError(fail)),
    pull: input => client.pull(input).pipe(Effect.mapError(fail)),
    fetch: input => client.fetch({ ...input, fields: [...input.fields] }).pipe(Effect.mapError(fail)),
    resolve: input => client.resolve(input).pipe(Effect.mapError(fail)),
    push: input => client.push(input).pipe(Effect.mapError(fail)),
    create: input => client.create(input).pipe(Effect.mapError(fail)),
    comment: input => client.comment(input).pipe(Effect.mapError(fail)),
    remove: input => client.remove(input).pipe(Effect.asVoid, Effect.mapError(fail)),
  }
}

/**
 * Every provider kind the backlog can sync with: the built-ins (Linear, GitHub, files), then each plugin serving the
 * `backlog-provider` Host API, asked once a minute what it provides. A built-in kind wins over an external one of the
 * same name; an external provider that fails to describe itself is skipped and logged.
 */
export class BacklogProviderRegistry extends Context.Service<
  BacklogProviderRegistry,
  {
    readonly all: Effect.Effect<readonly BacklogProvider[]>
    readonly get: (kind: string) => Effect.Effect<BacklogProvider, SyncProviderUnknown>
    /** Providers whose reference patterns recognize `reference`, built-ins first. */
    readonly recognizing: (reference: string) => Effect.Effect<readonly BacklogProvider[]>
  }
>()('@dshfiles/backlog/BacklogProviderRegistry') {
  static readonly make = (builtIns: readonly BacklogProvider[]) =>
    Layer.effect(
      BacklogProviderRegistry,
      Effect.gen(function* () {
        const endpoints = yield* ExternalProviderEndpoints
        const cache = yield* Ref.make<{ readonly at: number; readonly providers: readonly BacklogProvider[] } | null>(null)
        const builtInKinds = new Set(builtIns.map(provider => provider.descriptor.kind))

        const external = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const cached = yield* Ref.get(cache)
          if (cached !== null && now - cached.at < DESCRIBE_TTL_MS) return cached.providers
          const listed = yield* endpoints.list
          const described = yield* Effect.forEach(
            listed,
            endpoint =>
              endpoint.client.describe({}).pipe(
                Effect.map(answer =>
                  answer.providers.filter(descriptor => !builtInKinds.has(descriptor.kind)).map(descriptor => adapt(descriptor, endpoint.client)),
                ),
                Effect.catch(error =>
                  Effect.as(Effect.logWarning('backlog provider did not describe itself; skipping it', { owner: endpoint.owner, error }), []),
                ),
              ),
            { concurrency: 'unbounded' },
          )
          const providers = described.flat()
          yield* Ref.set(cache, { at: now, providers })
          return providers
        })

        const all = Effect.map(external, providers => [...builtIns, ...providers])
        const get = (kind: string) =>
          Effect.flatMap(all, providers => {
            const found = providers.find(provider => provider.descriptor.kind === kind)
            return found === undefined ? Effect.fail(new SyncProviderUnknown({ kind })) : Effect.succeed(found)
          })
        const recognizing = (reference: string) =>
          Effect.map(all, providers => providers.filter(provider => BacklogProviders.recognizes(provider.descriptor, reference)))
        return BacklogProviderRegistry.of({ all, get, recognizing })
      }),
    )
}
