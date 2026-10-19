import type { FallbackRoute } from './model-fallback-api.js'

/** `provider/model`, the reference DSH itself uses; a provider id never contains a slash, a model id may. */
const routeKey = (route: Pick<FallbackRoute, 'provider' | 'model'>): string => `${route.provider}/${route.model}`

const sameRoute = (left: Pick<FallbackRoute, 'provider' | 'model'>, right: Pick<FallbackRoute, 'provider' | 'model'>): boolean =>
  left.provider === right.provider && left.model === right.model

/**
 * The routes to try after `current` failed, in order: the chain entries after the current one, then the ones before
 * it, skipping routes this turn already tried and routes that cannot take a request now (disabled or cooling
 * accounts, providers this Host does not serve).
 */
const remainingFallbacks = (input: {
  readonly chain: readonly FallbackRoute[]
  readonly current: Pick<FallbackRoute, 'provider' | 'model'>
  readonly tried: ReadonlySet<string>
  readonly available: (route: FallbackRoute) => boolean
}): FallbackRoute[] => {
  const position = input.chain.findIndex(route => sameRoute(route, input.current))
  const ordered = position < 0 ? input.chain : [...input.chain.slice(position + 1), ...input.chain.slice(0, position)]
  return ordered.filter(route => !sameRoute(route, input.current) && !input.tried.has(routeKey(route)) && input.available(route))
}

/** The routes a thread walks: its own chain when it has one, else the global default. */
const effectiveChain = (input: { readonly defaultChain: readonly FallbackRoute[]; readonly threadChain: readonly FallbackRoute[] | null }) =>
  input.threadChain ?? input.defaultChain

/** Duplicate provider/model pairs collapse to their first position, so one route never runs twice in one walk. */
const normalizeChain = (chain: readonly FallbackRoute[]): FallbackRoute[] => {
  const seen = new Set<string>()
  return chain.filter(route => {
    const key = routeKey(route)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The Session model selection naming one route; an absent effort leaves the model's default. */
const selectionFor = (route: FallbackRoute): { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } =>
  route.reasoningEffort === undefined
    ? { provider: route.provider, model: route.model }
    : { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort }

export class ModelFallbackModel {
  static readonly routeKey = routeKey
  static readonly sameRoute = sameRoute
  static readonly remainingFallbacks = remainingFallbacks
  static readonly effectiveChain = effectiveChain
  static readonly normalizeChain = normalizeChain
  static readonly selectionFor = selectionFor
}
