import { z } from 'zod'
import type { AccountDraft, AccountsCatalog } from './api.js'

type CatalogModel = AccountsCatalog['models'][number]

const additionalModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\s\p{C}]+$/u)

export const parseAdditionalModelId = (input: string, account: Pick<AccountDraft, 'instanceId' | 'kind'>): string | null => {
  const value = input.trim()
  const prefixes = [`${account.instanceId}/`, ...(account.kind === 'opencode-go' ? ['opencode-go/'] : [])]
  const prefix = prefixes.find(candidate => value.startsWith(candidate))
  const candidate = prefix === undefined ? value : value.slice(prefix.length)
  const parsed = additionalModelIdSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export const catalogForCuration = (input: {
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
