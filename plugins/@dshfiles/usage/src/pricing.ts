import { CostEstimateModel } from '@dshfiles/ai-accounts/cost-estimate'
import { PricingCatalogModel, type PricingCache } from '@dshfiles/ai-accounts/pricing-catalog'
import { Context, Effect, FileSystem, Layer, Option, Ref, Schema } from 'effect'
import type { UsageStoreFailed } from './errors.js'
import { type Rates, type RouteBand, UsageRepo } from './store.js'

/**
 * Prices come from AI Accounts' models.dev catalog, the same file its cost
 * readout uses. This plugin only reads that cache; AI Accounts owns fetching
 * it. Subscription routes are priced at list price, so every figure is an
 * estimate of what the traffic would cost on a metered key.
 */

const PER_MILLION = 1_000_000
const decodeCatalog = Schema.decodeUnknownEffect(Schema.fromJsonString(PricingCatalogModel.cacheSchema))

/** USD per million tokens for one route at one context band, tiers included. */
export const ratesAt = (input: { readonly price: Parameters<typeof CostEstimateModel.costOfTokens>[0]['price']; readonly band: number }): Rates => {
  const unit = (bucket: 'uncachedInputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens') =>
    CostEstimateModel.costOfTokens({
      tokens: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, [bucket]: PER_MILLION },
      price: input.price,
      band: input.band,
    }).total
  return { input: unit('uncachedInputTokens'), output: unit('outputTokens'), cacheRead: unit('cacheReadTokens'), cacheWrite: unit('cacheWriteTokens') }
}

const ratesFor = (input: {
  readonly cache: PricingCache
  readonly routes: readonly RouteBand[]
  readonly kinds: ReadonlyMap<string, string>
}): Map<string, { readonly route: RouteBand; readonly rates: Rates }> => {
  const rates = new Map<string, { readonly route: RouteBand; readonly rates: Rates }>()
  for (const route of input.routes) {
    const kind = input.kinds.get(route.provider)
    const quote = PricingCatalogModel.resolveRouteQuote({
      route: { provider: route.provider, model: route.model },
      cache: input.cache,
      ...(kind !== undefined && { accountKind: kind }),
      overrides: {},
    })
    if (quote.price === null) continue
    rates.set(`${CostEstimateModel.routeKey(route)}@${String(route.band)}`, { route, rates: ratesAt({ price: quote.price, band: route.band }) })
  }
  return rates
}

/** Account instance id → kind from AI Accounts, so subscription routes resolve their quote; empty when it is absent. */
export class AccountKinds extends Context.Service<AccountKinds, { readonly read: Effect.Effect<ReadonlyMap<string, string>> }>()(
  '@dshfiles/usage/AccountKinds',
) {}

export class Pricing extends Context.Service<
  Pricing,
  {
    /** Price new routes; re-price everything when the catalog file changed since the last call. */
    readonly update: Effect.Effect<void, UsageStoreFailed>
    readonly fetchedAt: Effect.Effect<number | null>
  }
>()('@dshfiles/usage/Pricing') {
  static readonly layer = (input: { readonly catalogPath: string }) =>
    Layer.effect(
      Pricing,
      Effect.gen(function* () {
        const repo = yield* UsageRepo
        const accountKinds = yield* AccountKinds
        const fileSystem = yield* FileSystem.FileSystem
        const catalog = yield* Ref.make<{ readonly mtimeMs: number; readonly cache: Option.Option<PricingCache> }>({ mtimeMs: -1, cache: Option.none() })

        const catalogMtime = fileSystem.stat(input.catalogPath).pipe(
          Effect.map(info => Option.match(info.mtime, { onNone: () => 0, onSome: date => date.getTime() })),
          Effect.orElseSucceed(() => -1),
        )

        // No catalog yet, or an unreadable one: keep the previous one; AI Accounts writes a fresh file on its next refresh.
        const readCatalog = fileSystem.readFileString(input.catalogPath).pipe(Effect.flatMap(decodeCatalog), Effect.option)

        const update = Effect.fn('usage pricing update')(function* () {
          const mtimeMs = yield* catalogMtime
          const previous = yield* Ref.get(catalog)
          const catalogChanged = mtimeMs !== previous.mtimeMs
          const loaded = catalogChanged ? yield* readCatalog : Option.none<PricingCache>()
          const newer = Option.filter(loaded, cache => Option.match(previous.cache, { onNone: () => true, onSome: known => cache.fetchedAt > known.fetchedAt }))
          const current = Option.orElse(newer, () => previous.cache)
          yield* Ref.set(catalog, { mtimeMs: catalogChanged ? mtimeMs : previous.mtimeMs, cache: current })
          if (Option.isNone(current)) return
          const cache = current.value
          const replace = catalogChanged || (yield* repo.getMeta('pricingFetchedAt')) !== String(cache.fetchedAt)
          const routes = replace ? yield* repo.routeBands : yield* repo.unratedRouteBands
          if (routes.length === 0 && !replace) return
          yield* repo.writeRates({ rates: ratesFor({ cache, routes, kinds: yield* accountKinds.read }), replace })
          yield* repo.setMeta({ key: 'pricingFetchedAt', value: String(cache.fetchedAt) })
        })

        return Pricing.of({
          update: update(),
          fetchedAt: Effect.map(Ref.get(catalog), state => Option.getOrNull(Option.map(state.cache, cache => cache.fetchedAt))),
        })
      }),
    )
}
