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

export const selectRequestAccount = (input: {
  readonly provider: string
  readonly model: string
  readonly conversationKey?: string
  readonly routes: ReadonlyMap<string, RoutableAccount>
  readonly pool: Pick<AccountPool, 'acquire' | 'distribution'>
  readonly modelsCompatible: (sourceProvider: string, candidateProvider: string, model: string) => boolean
  readonly now?: number
}): string => {
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

export const failoverAccountIds = (input: {
  readonly from: string
  readonly model: string | undefined
  readonly routes: ReadonlyMap<string, RoutableAccount>
  readonly distribution: Distribution
  readonly usageOrder: readonly string[]
  readonly hiddenAccountIds: readonly string[]
  readonly modelsCompatible: (sourceProvider: string, candidateProvider: string, model: string) => boolean
}): string[] => {
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
