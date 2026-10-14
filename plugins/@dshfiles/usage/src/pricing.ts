import { readFile, stat } from 'node:fs/promises'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { z } from 'zod'
import { costOfTokens, routeKey } from '@dshfiles/ai-accounts/cost-estimate'
import { createPricingCatalog, DEFAULT_PRICING_PATH, resolveRouteQuote, type PricingCache } from '@dshfiles/ai-accounts/pricing-catalog'
import type { Rates, RouteBand, UsageStore } from './store.js'

/**
 * Prices come from AI Accounts' models.dev catalog, the same file its cost
 * readout uses. This plugin only reads that cache; AI Accounts owns fetching
 * it. Subscription routes are priced at list price, so every figure is an
 * estimate of what the traffic would cost on a metered key.
 */

const PER_MILLION = 1_000_000

/** USD per million tokens for one route at one context band, tiers included. */
export const ratesAt = (input: { readonly price: Parameters<typeof costOfTokens>[0]['price']; readonly band: number }): Rates => {
  const unit = (bucket: 'uncachedInputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens') =>
    costOfTokens({
      tokens: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, [bucket]: PER_MILLION },
      price: input.price,
      band: input.band,
    }).total
  return { input: unit('uncachedInputTokens'), output: unit('outputTokens'), cacheRead: unit('cacheReadTokens'), cacheWrite: unit('cacheWriteTokens') }
}

const accountsFileSchema = z.object({ accounts: z.array(z.object({ kind: z.string(), instanceId: z.string() })).catch([]) })

/** AI Accounts may be absent or another version: an unreadable file just means "kind unknown". */
const readAccountKinds = async (): Promise<ReadonlyMap<string, string>> => {
  try {
    const parsed = accountsFileSchema.safeParse(JSON.parse(await readFile(dshHomePath('plugins', 'ai-accounts', 'accounts.json'), 'utf8')))
    return new Map(parsed.success ? parsed.data.accounts.map(account => [account.instanceId, account.kind] as const) : [])
  } catch {
    return new Map()
  }
}

const ratesFor = (input: {
  readonly cache: PricingCache
  readonly routes: readonly RouteBand[]
  readonly kinds: ReadonlyMap<string, string>
}): Map<string, { readonly route: RouteBand; readonly rates: Rates }> => {
  const rates = new Map<string, { readonly route: RouteBand; readonly rates: Rates }>()
  for (const route of input.routes) {
    const kind = input.kinds.get(route.provider)
    const quote = resolveRouteQuote({
      route: { provider: route.provider, model: route.model },
      cache: input.cache,
      ...(kind === undefined ? {} : { accountKind: kind }),
      overrides: {},
    })
    if (quote.price === null) continue
    rates.set(`${routeKey(route)}@${String(route.band)}`, { route, rates: ratesAt({ price: quote.price, band: route.band }) })
  }
  return rates
}

export const createRatePricer = (options: { readonly store: UsageStore; readonly pricingPath?: string }) => {
  const pricingPath = options.pricingPath ?? DEFAULT_PRICING_PATH
  const catalog = createPricingCatalog({ path: pricingPath })
  let loadedMtime = -1

  /** Price new routes; re-price everything when the catalog file changed since the last call. */
  const update = async (): Promise<void> => {
    const mtime = (await stat(pricingPath).catch(() => undefined))?.mtimeMs ?? -1
    const catalogChanged = mtime !== loadedMtime
    if (catalogChanged) {
      await catalog.load()
      loadedMtime = mtime
    }
    const cache = catalog.current()
    if (cache === null) return
    const replace = catalogChanged || options.store.getMeta('pricingFetchedAt') !== String(cache.fetchedAt)
    const routes = replace ? options.store.routeBands() : options.store.unratedRouteBands()
    if (routes.length === 0 && !replace) return
    options.store.writeRates({ rates: ratesFor({ cache, routes, kinds: await readAccountKinds() }), replace })
    options.store.setMeta('pricingFetchedAt', String(cache.fetchedAt))
  }

  return { update, fetchedAt: (): number | null => catalog.current()?.fetchedAt ?? null }
}
