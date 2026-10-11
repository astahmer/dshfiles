import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'

type ModelGroup = ModelDirectoryState['groups'][number]
type CatalogModel = ModelGroup['models'][number]

export const filterModelGroups = (groups: readonly ModelGroup[], query: string): readonly ModelGroup[] => {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return groups

  return groups
    .map(group => {
      const providerMatches = `${group.name} ${group.id}`.toLowerCase().includes(needle)
      const models = providerMatches
        ? group.models
        : group.models.filter(model => `${model.name} ${model.id} ${model.description ?? ''}`.toLowerCase().includes(needle))
      return { ...group, models }
    })
    .filter(group => group.models.length > 0)
}

export const selectionForModel = (group: Pick<ModelGroup, 'id'>, model: CatalogModel, current: ModelSelection | null): ModelSelection => {
  const reasoningEffort = group.id === current?.provider && model.id === current.model ? current.reasoningEffort : model.reasoning?.defaultEffort
  return {
    provider: group.id,
    model: model.id,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

export const selectionForEffort = (current: ModelSelection, reasoningEffort: string | undefined): ModelSelection => ({
  provider: current.provider,
  model: current.model,
  ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
})

export const effortName = (model: CatalogModel, current: ModelSelection | null): string => {
  const selected = current?.reasoningEffort ?? model.reasoning?.defaultEffort
  if (selected === undefined) return 'Provider default'
  return model.reasoning?.efforts.find(effort => effort.id === selected)?.name ?? selected
}
