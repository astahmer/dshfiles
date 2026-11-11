/**
 * A picker gesture asks the sidebar's fan-out dialog to open with its models preselected. Published as the
 * `@dshfiles/thread-sidebar/fan-out-request` dshx module; importing it loads none of the sidebar's runtime.
 */
export interface FanOutRouteRequest {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export const FAN_OUT_REQUEST_EVENT = 'dshfiles:fan-out'

/** Bounded like the Host fan-out method: two through six routes, one per provider and model. */
export const fanOutRoutesOf = (value: unknown): readonly FanOutRouteRequest[] | undefined => {
  if (typeof value !== 'object' || value === null || !('models' in value)) return undefined
  const models = (value as { readonly models?: unknown }).models
  if (!Array.isArray(models)) return undefined
  const routes: FanOutRouteRequest[] = []
  for (const entry of models) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const route = entry as { readonly provider?: unknown; readonly model?: unknown; readonly reasoningEffort?: unknown }
    if (typeof route.provider !== 'string' || route.provider.length === 0 || typeof route.model !== 'string' || route.model.length === 0) return undefined
    if (route.reasoningEffort !== undefined && typeof route.reasoningEffort !== 'string') return undefined
    routes.push({
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined ? undefined : { reasoningEffort: route.reasoningEffort }),
    })
  }
  if (routes.length < 2 || routes.length > 6) return undefined
  return routes
}

/** Ask the running sidebar to open its fan-out dialog with these models already selected. */
export const requestFanOut = (models: readonly FanOutRouteRequest[]): void => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(FAN_OUT_REQUEST_EVENT, { detail: { models } }))
}
