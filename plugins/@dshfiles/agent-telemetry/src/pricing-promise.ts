import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { DEFAULT_PRICING_PATH, type PricingCache } from '@dshfiles/ai-accounts/pricing-catalog'
import { PricingCatalog as PricingCatalogService } from '@dshfiles/ai-accounts/pricing-catalog-service'
import { DshxPlugin } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { flushTracing, pluginAttributes } from '@dshfiles/dshx/tracing'
import { Context, Duration, Effect, Layer, Queue, Ref, Schedule } from 'effect'

const RELOAD_EVERY = Duration.minutes(5)
const MISS_RETRY_AFTER = Duration.seconds(30)

/**
 * AI Accounts' models.dev price cache and the account kinds it prices with, reloaded every five minutes and again (at
 * most every 30 seconds) when a priced call finds no cache. Reads are synchronous because the span coordinator prices
 * every model chunk on the stream's hot path.
 */
export class PricingCatalog extends Context.Service<
  PricingCatalog,
  {
    readonly current: () => PricingCache | null
    readonly accountKind: (provider: string) => string | undefined
    readonly reload: Effect.Effect<void>
  }
>()('@dshfiles/agent-telemetry/PricingCatalog') {
  static readonly layerFrom = (options: { readonly path: string }) =>
    Layer.effect(
      PricingCatalog,
      Effect.gen(function* () {
        const catalog = yield* PricingCatalogService
        const accounts = (yield* HostApis).client(aiAccountsApi)
        const kinds = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
        const misses = yield* Queue.dropping<void>(1)

        const reload = Effect.gen(function* () {
          yield* catalog.load
          const file = yield* Effect.option(accounts.read())
          if (file._tag === 'Some') yield* Ref.set(kinds, new Map(file.value.accounts.map(account => [account.instanceId, account.kind] as const)))
          yield* Effect.annotateCurrentSpan(
            pluginAttributes({ plugin: 'agent-telemetry', attributes: { cached: catalog.snapshot() !== null, accounts: (yield* Ref.get(kinds)).size } }),
          )
        }).pipe(Effect.withSpan('agent telemetry pricing reload'))

        yield* DshxPlugin.worker(Effect.repeat(reload, Schedule.spaced(RELOAD_EVERY)))
        yield* DshxPlugin.worker(
          Queue.take(misses).pipe(
            Effect.andThen(reload),
            Effect.andThen(Effect.sleep(MISS_RETRY_AFTER)),
            Effect.andThen(Queue.takeAll(misses)),
            Effect.forever,
          ),
        )

        return PricingCatalog.of({
          current: () => {
            const cache = catalog.snapshot()
            if (cache === null) Queue.offerUnsafe(misses, undefined)
            return cache
          },
          accountKind: provider => Ref.getUnsafe(kinds).get(provider),
          reload,
        })
      }),
    ).pipe(Layer.provide(PricingCatalogService.layerLive({ path: options.path })))

  static readonly layer = PricingCatalog.layerFrom({ path: DEFAULT_PRICING_PATH })
}

/** Export the spans the coordinator ended so a reload or shutdown does not drop the last turn. */
export const flushTraces = Effect.promise(() => flushTracing())
