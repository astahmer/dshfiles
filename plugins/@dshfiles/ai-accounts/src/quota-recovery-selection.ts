import type { QuotaRecoveryModelCatalog, QuotaRecoveryModelSelection } from './api.js'

const selectionFor = (
  provider: string,
  model: { readonly id: string; readonly reasoning?: { readonly defaultEffort?: string | undefined } | undefined },
): QuotaRecoveryModelSelection => {
  const selection: QuotaRecoveryModelSelection = { provider, model: model.id }
  if (model.reasoning?.defaultEffort === undefined) return selection
  return { ...selection, reasoningEffort: model.reasoning.defaultEffort }
}

export const suggestedQuotaRecoverySelection = (
  catalog: QuotaRecoveryModelCatalog,
  failedRoute: { readonly provider: string | undefined; readonly model: string | undefined },
): QuotaRecoveryModelSelection => {
  const sameModelOnAnotherProvider = catalog.groups
    .filter(group => group.id !== failedRoute.provider)
    .flatMap(group => group.models.filter(model => model.id === failedRoute.model).map(model => selectionFor(group.id, model)))[0]
  if (sameModelOnAnotherProvider !== undefined) return sameModelOnAnotherProvider

  const defaultModel = catalog.groups.find(group => group.id === catalog.default.provider)?.models.find(model => model.id === catalog.default.model)
  if (catalog.default.provider !== failedRoute.provider) {
    const selection: QuotaRecoveryModelSelection = { ...catalog.default }
    if (selection.reasoningEffort === undefined && defaultModel?.reasoning?.defaultEffort !== undefined) {
      selection.reasoningEffort = defaultModel.reasoning.defaultEffort
    }
    return selection
  }

  const otherProvider = catalog.groups.find(group => group.id !== failedRoute.provider)
  const otherModel = otherProvider?.models[0]
  if (otherProvider !== undefined && otherModel !== undefined) return selectionFor(otherProvider.id, otherModel)

  return catalog.default
}
