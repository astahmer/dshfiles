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

  /** One stable table, with filtering applied after the saved order. */
  static curationRows = (catalog: readonly CatalogModel[], order: readonly string[], search: string): CatalogModel[] => {
    const listed = [...new Set(order)].filter(id => catalog.some(model => model.id === id))
    const ordered = [...listed.flatMap(id => catalog.find(model => model.id === id) ?? []), ...catalog.filter(model => !listed.includes(model.id))]
    const query = search.trim().toLocaleLowerCase()
    return ordered.filter(model => `${model.name} ${model.id}`.toLocaleLowerCase().includes(query))
  }

  static removeAdditionalModel = (account: AccountDraft, modelId: string): Partial<AccountDraft> => {
    const reasoningDefaults = { ...account.reasoningDefaults }
    delete reasoningDefaults[modelId]
    return {
      additionalModelIds: account.additionalModelIds.filter(id => id !== modelId),
      hiddenModelIds: account.hiddenModelIds.filter(id => id !== modelId),
      favoriteModelIds: account.favoriteModelIds.filter(id => id !== modelId),
      modelOrder: account.modelOrder.filter(id => id !== modelId),
      reasoningDefaults,
    }
  }
}
