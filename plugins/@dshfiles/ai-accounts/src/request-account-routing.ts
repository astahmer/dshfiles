import type { AccountPool, Distribution } from './account-pool.js'

interface RoutableAccount {
  readonly kind: string
  readonly enabled: boolean
}

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
    const account = input.pool.acquire({
      candidateIds: compatibleAccountIds(input),
      scopeKey: source.kind,
      ...(input.conversationKey === undefined ? {} : { conversationKey: input.conversationKey }),
      ...(input.now === undefined ? {} : { now: input.now }),
    })
    return account?.id ?? input.provider
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
