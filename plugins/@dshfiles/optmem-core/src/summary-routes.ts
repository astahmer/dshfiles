/**
 * Model matching shared by the Host route selection and the settings panel's validation. Browser-safe: no DSH runtime
 * imports, so the client bundle can check a route against the same rules the Host applies.
 */
export class SummaryRouting {
  /** The offered id for one candidate; a candidate ending in `*` matches every id with that prefix and takes the newest. */
  static offeredModel(candidate: string, offered: readonly string[]): string | undefined {
    const matches = (id: string, wanted: string): boolean => id === wanted || id.endsWith(`/${wanted}`)
    if (!candidate.endsWith('*')) return offered.find(id => matches(id, candidate))
    const prefix = candidate.slice(0, -1)
    const newestFirst = offered
      .filter(id => id.startsWith(prefix) || id.includes(`/${prefix}`))
      .toSorted((left, right) => right.localeCompare(left, 'en', { numeric: true }))
    return newestFirst[0]
  }

  /** The cheap-model entry for a provider: exact provider id, then its AI Accounts kind, then the longest id prefix. */
  static cheapEntryFor<Entry extends { readonly kind: string }>(
    entries: readonly Entry[],
    provider: string,
    accountKind: string | undefined,
  ): Entry | undefined {
    return (
      entries.find(entry => entry.kind === provider) ??
      (accountKind === undefined ? undefined : entries.find(entry => entry.kind === accountKind)) ??
      entries
        .filter(entry => provider.startsWith(`${entry.kind}-`) || provider.startsWith(`${entry.kind}_`))
        .toSorted((left, right) => right.kind.length - left.kind.length)[0]
    )
  }
}

export type SummaryEffort = 'off' | 'low' | 'medium' | 'high'

/** A fixed route; an empty provider means the provider of the thread being summarized. */
export type RouteEntry = { readonly provider: string; readonly model: string; readonly effort?: SummaryEffort | undefined }

/**
 * The cheap models of one provider kind (`codex`, `claude`, ...) or one exact provider id, in preference order. A model
 * ending in `*` matches every offered id with that prefix and takes the newest.
 */
export type CheapModelEntry = { readonly kind: string; readonly models: readonly string[]; readonly effort?: SummaryEffort | undefined }

export type SummarizerPolicy = {
  /** Paused in settings: every summary waits and retries, nothing is called. */
  readonly paused?: boolean | undefined
  readonly override: RouteEntry | undefined
  readonly cheapModels: readonly CheapModelEntry[]
  readonly fallbacks: readonly RouteEntry[]
}

export type SummaryRoute = { readonly provider: string; readonly model: string; readonly effort: SummaryEffort | undefined }

export type SummarizerRouteState =
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'ready'; readonly conversationId: string; readonly source: 'override' | 'account' | 'fallback'; readonly route: SummaryRoute }
  | { readonly kind: 'unavailable'; readonly conversationId: string; readonly reason: string }

/** What the Host knows about providers and threads; each lookup degrades to `undefined` / `[]` instead of throwing. */
export type RouteCatalog = {
  readonly sessionProvider: (conversationId: string) => Promise<string | undefined>
  readonly providerKind: (provider: string) => Promise<string | undefined>
  readonly models: (provider: string) => Promise<readonly string[]>
}

/**
 * Picks the route for one summary: the override when set, else the thread's own provider with that provider's cheap
 * model, then each fallback in order. Every candidate must be offered by its provider. It never uses the thread's own
 * (possibly expensive) model: with no candidate left the summary is skipped and retried later.
 */
export const selectSummaryRoute = async (request: {
  readonly policy: SummarizerPolicy
  readonly conversationId: string
  readonly catalog: RouteCatalog
  /** True for a route a provider already rejected for configuration reasons; it is skipped, not retried. */
  readonly skip?: ((route: SummaryRoute) => boolean) | undefined
}): Promise<SummarizerRouteState> => {
  const { policy, conversationId, catalog } = request
  if (policy.paused === true) return { kind: 'unavailable', conversationId, reason: 'summaries are paused in OptMem settings' }
  const sessionProvider = await catalog.sessionProvider(conversationId)
  const tried: string[] = []
  const quarantined = (route: SummaryRoute): boolean => {
    if (request.skip?.(route) !== true) return false
    tried.push(`${route.provider}/${route.model} (rejected by the provider)`)
    return true
  }
  const tryEntry = async (entry: RouteEntry): Promise<SummaryRoute | undefined> => {
    const provider = entry.provider.length > 0 ? entry.provider : sessionProvider
    if (provider === undefined) {
      tried.push(`${entry.model} (thread provider unknown)`)
      return undefined
    }
    const model = SummaryRouting.offeredModel(entry.model, await catalog.models(provider))
    if (model === undefined) {
      tried.push(`${provider}/${entry.model} (not offered)`)
      return undefined
    }
    const route: SummaryRoute = { provider, model, effort: entry.effort }
    return quarantined(route) ? undefined : route
  }

  if (policy.override !== undefined) {
    const route = await tryEntry(policy.override)
    if (route) return { kind: 'ready', conversationId, source: 'override', route }
  } else if (sessionProvider === undefined) tried.push('thread provider unknown')
  else {
    const cheap = SummaryRouting.cheapEntryFor(policy.cheapModels, sessionProvider, await catalog.providerKind(sessionProvider))
    if (cheap === undefined) tried.push(`${sessionProvider} (no cheap model configured)`)
    else {
      const offered = await catalog.models(sessionProvider)
      const model = cheap.models.map(candidate => SummaryRouting.offeredModel(candidate, offered)).find(found => found !== undefined)
      if (model !== undefined) {
        const route: SummaryRoute = { provider: sessionProvider, model, effort: cheap.effort }
        if (!quarantined(route)) return { kind: 'ready', conversationId, source: 'account', route }
      } else tried.push(`${sessionProvider}/${cheap.models.join('|')} (not offered)`)
    }
  }
  for (const fallback of policy.fallbacks) {
    const route = await tryEntry(fallback)
    if (route) return { kind: 'ready', conversationId, source: 'fallback', route }
  }
  return { kind: 'unavailable', conversationId, reason: `no cheap summary route: ${tried.join(', ')}` }
}

const routeCacheMs = 60_000

/** How long a route a provider rejected for configuration reasons stays out of selection. */
export const routeCooldownMs = 10 * 60_000

/** Remembers each thread's route for a minute, so a burst of summaries does not re-list provider models every call. */
export const createRouteResolver = (options: {
  readonly catalog: () => RouteCatalog
  readonly policy: () => SummarizerPolicy
  readonly now?: () => number
  /** Routes quarantined after a permanent provider rejection, keyed `provider/model`. */
  readonly unusable?: () => ReadonlyMap<string, { readonly until: number; readonly reason: string }> | undefined
}) => {
  const now = options.now ?? Date.now
  const cache = new Map<string, { readonly policy: string; readonly at: number; readonly state: SummarizerRouteState }>()
  let latest: SummarizerRouteState = { kind: 'unresolved' }

  const resolve = async (conversationId: string): Promise<SummarizerRouteState> => {
    const policy = options.policy()
    const policyKey = JSON.stringify(policy)
    const cached = cache.get(conversationId)
    if (cached && cached.policy === policyKey && now() - cached.at < routeCacheMs) return (latest = cached.state)
    const quarantined = options.unusable?.()
    const skip = (route: { readonly provider: string; readonly model: string }): boolean => {
      const entry = quarantined?.get(`${route.provider}/${route.model}`)
      return entry !== undefined && entry.until > now()
    }
    const state = await selectSummaryRoute({ policy, conversationId, catalog: options.catalog(), skip })
    cache.set(conversationId, { policy: policyKey, at: now(), state })
    return (latest = state)
  }

  /** Drop one thread's cached route so the next attempt re-selects past a quarantined route. */
  const invalidate = (conversationId: string): void => {
    cache.delete(conversationId)
  }

  return { resolve, invalidate, current: (): SummarizerRouteState => latest }
}
