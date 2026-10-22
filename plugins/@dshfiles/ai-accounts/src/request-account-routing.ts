import { LlmError } from '@deepseek-ai/dsh-llm'
import type { AccountPool, Distribution } from './account-pool.js'
import { CLAUDE_KIND } from './provider-routes.js'

interface RoutableAccount {
  readonly kind: string
  readonly enabled: boolean
}

/** Kinds that never fall back, and so can never be a fail-over target either. */
const NO_FALLBACK_KINDS: ReadonlySet<string> = new Set([CLAUDE_KIND])

const compatibleAccountIds = (input: {
  readonly provider: string
  readonly model: string | undefined
  readonly routes: ReadonlyMap<string, RoutableAccount>
  readonly modelsCompatible: (sourceProvider: string, candidateProvider: string, model: string) => boolean
}): string[] => {
  const source = input.routes.get(input.provider)
  if (source === undefined || !source.enabled) return []
  return [...input.routes].flatMap(([provider, route]) =>
    route.enabled && route.kind === source.kind && (input.model === undefined || input.modelsCompatible(input.provider, provider, input.model))
      ? [provider]
      : [],
  )
}

export class RequestAccountRouting {
  static selectRequestAccount(input: {
    readonly provider: string
    readonly model: string
    readonly conversationKey?: string
    readonly routes: ReadonlyMap<string, RoutableAccount>
    readonly pool: Pick<AccountPool, 'acquire' | 'distribution'>
    readonly modelsCompatible: (sourceProvider: string, candidateProvider: string, model: string) => boolean
    readonly now?: number | undefined
  }): string {
    if (input.pool.distribution() === 'sticky') return input.provider
    const source = input.routes.get(input.provider)
    if (source === undefined) return input.provider
    const candidate = { candidateIds: compatibleAccountIds(input), scopeKey: source.kind }
    const withConversation = input.conversationKey === undefined ? candidate : { ...candidate, conversationKey: input.conversationKey }
    const acquireInput = input.now === undefined ? withConversation : { ...withConversation, now: input.now }
    const account = input.pool.acquire(acquireInput)
    return account?.id ?? input.provider
  }

  /**
   * The account a Sticky conversation should send on. A bound stand-in wins; otherwise a cooling
   * selected route is moved to a healthy compatible account (same provider kind and model) and bound
   * there before the request goes out, instead of spending one doomed call on the spent account.
   */
  static preflightAccount(input: {
    readonly provider: string
    readonly model: string | undefined
    readonly conversationKey?: string
    readonly routes: ReadonlyMap<string, RoutableAccount>
    readonly pool: Pick<AccountPool, 'bindRoute' | 'distribution' | 'isHealthy' | 'routeFor'>
    readonly modelsCompatible: (sourceProvider: string, candidateProvider: string, model: string) => boolean
    readonly usageOrder?: readonly string[]
    readonly hiddenAccountIds?: readonly string[]
    readonly now?: number | undefined
  }): string {
    const source = input.routes.get(input.provider)
    if (source === undefined || !source.enabled) return input.provider
    const routed = input.pool.routeFor(input.conversationKey, input.provider, input.now)
    if (input.pool.isHealthy(input.provider, input.now)) return input.provider
    if (routed !== input.provider && input.pool.isHealthy(routed, input.now)) return routed
    const candidate = RequestAccountRouting.failoverAccountIds({
      from: input.provider,
      model: input.model,
      routes: input.routes,
      distribution: input.pool.distribution(),
      usageOrder: input.usageOrder ?? [],
      hiddenAccountIds: input.hiddenAccountIds ?? [],
      modelsCompatible: input.modelsCompatible,
    }).find(id => id !== routed && input.pool.isHealthy(id, input.now))
    if (candidate === undefined) return input.provider
    if (input.conversationKey !== undefined && input.conversationKey !== '') input.pool.bindRoute(input.conversationKey, input.provider, candidate)
    return candidate
  }

  /**
   * The account one turn request goes out on: Sticky preflights past a cooling route, a thread walking
   * its fallback chain keeps the route it selected, and every other mode distributes across accounts.
   */
  static selectTurnAccount(input: {
    readonly provider: string
    readonly model: string
    readonly conversationKey: string
    readonly routes: ReadonlyMap<string, RoutableAccount>
    readonly pool: Pick<AccountPool, 'acquire' | 'bindRoute' | 'distribution' | 'isHealthy' | 'routeFor'>
    readonly modelsCompatible: (sourceProvider: string, candidateProvider: string, model: string) => boolean
    readonly chainWalking: boolean
    readonly usageOrder?: readonly string[]
    readonly hiddenAccountIds?: readonly string[]
    readonly now?: number | undefined
  }): string {
    if (input.pool.distribution() === 'sticky') return RequestAccountRouting.preflightAccount(input)
    if (input.chainWalking) return input.pool.routeFor(input.conversationKey, input.provider, input.now)
    return RequestAccountRouting.selectRequestAccount(input)
  }

  static failoverAccountIds(input: {
    readonly from: string
    readonly model: string | undefined
    readonly routes: ReadonlyMap<string, RoutableAccount>
    readonly distribution: Distribution
    readonly usageOrder: readonly string[]
    readonly hiddenAccountIds: readonly string[]
    readonly modelsCompatible: (sourceProvider: string, candidateProvider: string, model: string) => boolean
  }): string[] {
    const source = input.routes.get(input.from)
    if (source === undefined || NO_FALLBACK_KINDS.has(source.kind)) return []
    const compatible = compatibleAccountIds({
      provider: input.from,
      model: input.model,
      routes: input.routes,
      modelsCompatible: input.modelsCompatible,
    })
    const compatibleIds = new Set(compatible)
    const hiddenIds = new Set(input.hiddenAccountIds)
    const preferred = input.distribution === 'priority' ? compatible : [...new Set([...input.usageOrder, ...compatible])]
    return preferred.filter(provider => provider !== input.from && compatibleIds.has(provider) && !hiddenIds.has(provider))
  }

  /**
   * What to do with a Session model selection: a provider this Host serves natively or as an enabled
   * account route is sent as selected; a provider with no adapter moves to a healthy account route that
   * offers the same model, or is reported unserved so the caller can raise a typed error naming it.
   */
  static selectionPreflight(input: {
    readonly provider: string
    readonly model: string
    readonly routes: ReadonlyMap<string, RoutableAccount>
    readonly nativeProviders: readonly string[]
    readonly offersModel: (provider: string, model: string) => boolean
    readonly pool: Pick<AccountPool, 'isHealthy'>
    readonly now?: number | undefined
  }): { readonly kind: 'served' } | { readonly kind: 'route'; readonly provider: string } | { readonly kind: 'unserved' } {
    if (input.routes.has(input.provider) || input.nativeProviders.includes(input.provider)) return { kind: 'served' }
    const route = [...input.routes].find(
      ([provider, route]) => route.enabled && input.offersModel(provider, input.model) && input.pool.isHealthy(provider, input.now),
    )?.[0]
    return route === undefined ? { kind: 'unserved' } : { kind: 'route', provider: route }
  }

  /** The typed error for a selection no adapter, account route or native provider can serve. */
  static unservedProviderError(provider: string): LlmError {
    return new LlmError(
      `No adapter serves provider "${provider}" on this Host. Pick a model from a configured provider, or add the account for "${provider}".`,
      'NO_ADAPTER',
    )
  }

  /**
   * The account that serves one request on the wire. A main request keeps the account its `agent/request` routing
   * chose; a side request (session title, compaction) carries no such routing, so under Priority it takes the first
   * healthy account itself instead of the selected route, which may be the one cooling down.
   */
  static wireAccountFor(input: {
    readonly provider: string
    readonly model: string
    readonly purpose: string | undefined
    readonly conversationKey: string | undefined
    readonly active: { readonly provider: string; readonly model: string; readonly accountId: string } | undefined
    readonly routes: ReadonlyMap<string, RoutableAccount>
    readonly pool: Pick<AccountPool, 'acquire' | 'distribution' | 'routeFor'>
    readonly modelsCompatible: (sourceProvider: string, candidateProvider: string, model: string) => boolean
    readonly now?: number
  }): string {
    const active = input.active
    if (input.purpose === undefined && active?.provider === input.provider && active.model === input.model) return active.accountId
    if (input.purpose !== undefined && input.pool.distribution() === 'priority') {
      return RequestAccountRouting.selectRequestAccount({
        provider: input.provider,
        model: input.model,
        routes: input.routes,
        pool: input.pool,
        modelsCompatible: input.modelsCompatible,
        now: input.now,
      })
    }
    return input.pool.routeFor(input.conversationKey, input.provider, input.now)
  }
}
