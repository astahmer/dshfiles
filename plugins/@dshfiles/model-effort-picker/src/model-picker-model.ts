import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { FallbackRoute } from '@dshfiles/ai-accounts/model-fallback-api'

type ModelGroup = ModelDirectoryState['groups'][number]
type CatalogModel = ModelGroup['models'][number]

/** A fallback rung named for display: catalog names when the catalog still lists the route, its ids otherwise. */
interface FallbackLabel {
  readonly provider: string
  readonly model: string
  readonly effort: string | undefined
}

export class ModelPickerModel {
  static filterGroups = (groups: readonly ModelGroup[], query: string): readonly ModelGroup[] => {
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

  static selectionForModel = (group: Pick<ModelGroup, 'id'>, model: CatalogModel, current: ModelSelection | null): ModelSelection => {
    const keepsEffort =
      current?.model === model.id &&
      (current.reasoningEffort === undefined || model.reasoning?.efforts.some(effort => effort.id === current.reasoningEffort) === true)
    const reasoningEffort = keepsEffort ? current?.reasoningEffort : model.reasoning?.defaultEffort
    return {
      provider: group.id,
      model: model.id,
      ...(reasoningEffort !== undefined && { reasoningEffort }),
    }
  }

  static selectionForEffort = (current: ModelSelection, reasoningEffort: string | undefined): ModelSelection => ({
    provider: current.provider,
    model: current.model,
    ...(reasoningEffort !== undefined && { reasoningEffort }),
  })

  /** Account providers prefix every model name with their instance id; under its provider the prefix says nothing. */
  static displayName = ({ group, model }: { readonly group: Pick<ModelGroup, 'id'>; readonly model: Pick<CatalogModel, 'name'> }): string =>
    model.name.startsWith(`${group.id}/`) ? model.name.slice(group.id.length + 1) : model.name

  /** The trigger names the provider (its initials) only when another provider offers the same model name. */
  static triggerLabel = ({
    groups,
    current,
  }: {
    readonly groups: readonly ModelGroup[]
    readonly current: ModelSelection
  }): { readonly model: string; readonly providerTag?: string; readonly title: string } | undefined => {
    const group = groups.find(candidate => candidate.id === current.provider)
    const model = group?.models.find(candidate => candidate.id === current.model)
    if (group === undefined || model === undefined) return undefined
    const name = ModelPickerModel.displayName({ group, model })
    const title = `${group.name} · ${name}`
    const ambiguous = groups.some(
      other => other.id !== group.id && other.models.some(candidate => ModelPickerModel.displayName({ group: other, model: candidate }) === name),
    )
    if (!ambiguous) return { model: name, title }
    const initials = group.name
      .split(/\s+/u)
      .filter(Boolean)
      .map(part => part[0])
      .join('')
      .slice(0, 3)
      .toUpperCase()
    return { model: name, providerTag: initials || group.id, title }
  }

  /**
   * The next route, in catalog order, that offers the selected model id: an account rotation that never changes the
   * model. `routes` narrows the rotation; empty means every route. The current effort carries over when the target
   * model advertises it, else the target's own default applies.
   */
  static nextAccountSelection = (input: {
    readonly groups: readonly ModelGroup[]
    readonly current: ModelSelection | null
    readonly routes: readonly string[]
  }): { readonly group: ModelGroup; readonly selection: ModelSelection } | undefined => {
    const current = input.current
    if (current === null) return undefined
    const candidates = input.groups.filter(
      group =>
        group.id === current.provider ||
        ((input.routes.length === 0 || input.routes.includes(group.id)) && group.models.some(model => model.id === current.model)),
    )
    const currentIndex = candidates.findIndex(group => group.id === current.provider)
    const group = [...candidates.slice(currentIndex + 1), ...candidates.slice(0, Math.max(currentIndex, 0))].find(
      candidate => candidate.id !== current.provider,
    )
    const model = group?.models.find(candidate => candidate.id === current.model)
    if (group === undefined || model === undefined) return undefined

    const keepsEffort = current.reasoningEffort === undefined || model.reasoning?.efforts.some(effort => effort.id === current.reasoningEffort) === true
    const reasoningEffort = keepsEffort ? current.reasoningEffort : model.reasoning?.defaultEffort
    const route: ModelSelection = { provider: group.id, model: model.id }
    return { group, selection: reasoningEffort === undefined ? route : { ...route, reasoningEffort } }
  }

  /** The current selection as a fallback rung, keeping its explicit effort only. */
  static fallbackFor = (current: ModelSelection): FallbackRoute =>
    current.reasoningEffort === undefined
      ? { provider: current.provider, model: current.model }
      : { provider: current.provider, model: current.model, reasoningEffort: current.reasoningEffort }

  /** Append a rung unless the chain already holds that provider and model. */
  static withFallback = (chain: readonly FallbackRoute[], route: FallbackRoute): readonly FallbackRoute[] =>
    chain.some(entry => entry.provider === route.provider && entry.model === route.model) ? chain : [...chain, route]

  static withoutFallback = (chain: readonly FallbackRoute[], index: number): readonly FallbackRoute[] => chain.filter((_, position) => position !== index)

  /** Swap one rung with its neighbour; a move past either end leaves the chain as it is. */
  static movedFallback = (chain: readonly FallbackRoute[], index: number, offset: -1 | 1): readonly FallbackRoute[] => {
    const target = index + offset
    const moving = chain[index]
    const displaced = chain[target]
    if (moving === undefined || displaced === undefined) return chain
    return chain.map((entry, position) => (position === index ? displaced : position === target ? moving : entry))
  }

  static fallbackLabel = (groups: readonly ModelGroup[], route: FallbackRoute): FallbackLabel => {
    const group = groups.find(candidate => candidate.id === route.provider)
    const model = group?.models.find(candidate => candidate.id === route.model)
    const label: FallbackLabel = { provider: group?.name ?? route.provider, model: model?.name ?? route.model, effort: undefined }
    const effort = route.reasoningEffort
    if (effort === undefined) return label
    return { ...label, effort: model?.reasoning?.efforts.find(entry => entry.id === effort)?.name ?? effort }
  }

  static effortName = (model: CatalogModel, current: ModelSelection | null): string => {
    const selected = current?.reasoningEffort ?? model.reasoning?.defaultEffort
    if (selected === undefined) return 'Provider default'
    return model.reasoning?.efforts.find(effort => effort.id === selected)?.name ?? selected
  }
}
