import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { createPricingCatalog, DEFAULT_PRICING_PATH, type PricingCache } from '@dshfiles/ai-accounts/pricing-catalog'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { flushTracing } from '@dshfiles/dshx/tracing'
import { Context, Duration, Effect, Layer, Queue, Ref, Schedule } from 'effect'

const RELOAD_EVERY = Duration.minutes(5)
const MISS_RETRY_AFTER = Duration.seconds(30)

/**
 * AI Accounts' models.dev price cache and account kinds, reloaded every five minutes and again (at most every 30
 * seconds) when a priced call finds no cache. Reads are synchronous because the span coordinator prices every
 * model chunk on the stream's hot path.
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
        const catalog = createPricingCatalog({ path: options.path })
        const accounts = (yield* HostApis).client(aiAccountsApi)
        const kinds = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
        const misses = yield* Queue.dropping<void>(1)

        const reload = Effect.gen(function* () {
          yield* Effect.promise(() => catalog.load())
          const file = yield* Effect.option(accounts.read())
          if (file._tag === 'Some') yield* Ref.set(kinds, new Map(file.value.accounts.map(account => [account.instanceId, account.kind] as const)))
        }).pipe(Effect.withSpan('agent telemetry pricing reload'))

        yield* Effect.forkScoped(Effect.repeat(reload, Schedule.spaced(RELOAD_EVERY)))
        yield* Queue.take(misses).pipe(
          Effect.andThen(reload),
          Effect.andThen(Effect.sleep(MISS_RETRY_AFTER)),
          Effect.andThen(Queue.takeAll(misses)),
          Effect.forever,
          Effect.forkScoped,
        )

        return PricingCatalog.of({
          current: () => {
            const cache = catalog.current()
            if (cache === null) Queue.offerUnsafe(misses, undefined)
            return cache
          },
          accountKind: provider => Ref.getUnsafe(kinds).get(provider),
          reload,
        })
      }),
    )

  static readonly layer = PricingCatalog.layerFrom({ path: DEFAULT_PRICING_PATH })
}

/** Export the spans the coordinator ended so a reload or shutdown does not drop the last turn. */
export const flushTraces = Effect.promise(() => flushTracing())
