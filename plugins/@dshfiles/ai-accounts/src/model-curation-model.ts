import { z } from 'zod'
import type { AccountDraft, AccountsCatalog } from './api.js'

type CatalogModel = AccountsCatalog['models'][number]

const additionalModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\s\p{C}]+$/u)

export class ModelCurationModel {
  static parseAdditionalModelId = (input: string, account: Pick<AccountDraft, 'instanceId' | 'kind'>): string | null => {
    const value = input.trim()
    const prefixes = [`${account.instanceId}/`, ...(account.kind === 'opencode-go' ? ['opencode-go/'] : [])]
    const prefix = prefixes.find(candidate => value.startsWith(candidate))
    const candidate = prefix === undefined ? value : value.slice(prefix.length)
    const parsed = additionalModelIdSchema.safeParse(candidate)
    return parsed.success ? parsed.data : null
  }

  static toggleFavoriteModel = (input: {
    readonly modelId: string
    readonly orderedModelIds: readonly string[]
    readonly favoriteModelIds: readonly string[]
    readonly hiddenModelIds: readonly string[]
  }) => {
    const nextFavorites = new Set(input.favoriteModelIds)
    const wasFavorite = nextFavorites.has(input.modelId)
    if (wasFavorite) nextFavorites.delete(input.modelId)
    else nextFavorites.add(input.modelId)
    const favoriteModelIds = [...nextFavorites]
    const favoritesFirst = input.orderedModelIds.filter(id => nextFavorites.has(id))
    const rest = input.orderedModelIds.filter(id => !nextFavorites.has(id))
    const modelOrder = [...favoritesFirst, ...rest]
    if (wasFavorite) return { favoriteModelIds, modelOrder }
    return { favoriteModelIds, hiddenModelIds: input.hiddenModelIds.filter(id => id !== input.modelId), modelOrder }
  }

  static removeAdditionalModel = (input: {
    readonly modelId: string
    readonly account: Pick<AccountDraft, 'additionalModelIds' | 'hiddenModelIds' | 'favoriteModelIds' | 'modelOrder' | 'reasoningDefaults'>
  }): Pick<AccountDraft, 'additionalModelIds' | 'hiddenModelIds' | 'favoriteModelIds' | 'modelOrder' | 'reasoningDefaults'> | null => {
    if (!input.account.additionalModelIds.includes(input.modelId)) return null
    const reasoningDefaults = { ...input.account.reasoningDefaults }
    delete reasoningDefaults[input.modelId]
    return {
      additionalModelIds: input.account.additionalModelIds.filter(id => id !== input.modelId),
      hiddenModelIds: input.account.hiddenModelIds.filter(id => id !== input.modelId),
      favoriteModelIds: input.account.favoriteModelIds.filter(id => id !== input.modelId),
      modelOrder: input.account.modelOrder.filter(id => id !== input.modelId),
      reasoningDefaults,
    }
  }

  static removableAdditionalModelIds = (input: {
    readonly catalog: readonly CatalogModel[]
    readonly additionalModelIds: readonly string[]
  }): ReadonlySet<string> => {
    const providerModelIds = new Set(input.catalog.map(model => model.id))
    return new Set(input.additionalModelIds.filter(id => !providerModelIds.has(id)))
  }

  static catalogForCuration = (input: {
    readonly catalog: readonly CatalogModel[]
    readonly additionalModelIds: readonly string[]
    readonly hiddenModelIds: readonly string[]
  }): CatalogModel[] => {
    const models = [...input.catalog]
    const known = new Set(models.map(model => model.id))
    for (const id of [...input.additionalModelIds, ...input.hiddenModelIds]) {
      if (known.has(id)) continue
      known.add(id)
      models.push({ id, name: id, efforts: [], defaultEffort: null })
    }
    return models
  }
}
