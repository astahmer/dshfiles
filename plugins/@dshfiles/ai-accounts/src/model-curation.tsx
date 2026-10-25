import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyDescription } from '@dshfiles/plugin-ui/components/ui/empty'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Combobox } from '@dshfiles/plugin-ui/components/ui/combobox'
import { ActionHint } from './panel-primitives.js'
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, StarIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useState } from 'react'
import type { AccountDraft, AccountsCatalog } from './api.js'
import { ModelCurationModel } from './model-curation-model.js'

type CatalogModel = AccountsCatalog['models'][number]

export type CurationPatch = Partial<Pick<AccountDraft, 'additionalModelIds' | 'hiddenModelIds' | 'favoriteModelIds' | 'modelOrder' | 'reasoningDefaults'>>

/** A distinct option removes a pinned effort instead of writing a provider-default value. */
const PROVIDER_DEFAULT = '__provider-default__'

/**
 * Model curation: favorite, hide, and reorder an account's models.
 *
 * Reordering is explicit rather than a full sort, so a model the provider adds
 * later appears after the curated ones instead of displacing them. The rows are
 * split into Favorites, All, and Hidden groups so a long catalog stays readable.
 */
export const ModelCuration = (props: {
  readonly account: AccountDraft
  readonly catalog: readonly CatalogModel[]
  readonly onChange: (patch: CurationPatch) => void
}): JSX.Element => {
  const { additionalModelIds, hiddenModelIds, favoriteModelIds, modelOrder, reasoningDefaults } = props.account
  const [search, setSearch] = useState('')
  const [modelIdInput, setModelIdInput] = useState({ instanceId: props.account.instanceId, value: '' })
  const modelIdValue = modelIdInput.instanceId === props.account.instanceId ? modelIdInput.value : ''
  const catalog = ModelCurationModel.catalogForCuration({ catalog: props.catalog, additionalModelIds, hiddenModelIds })
  const customModelId = ModelCurationModel.parseAdditionalModelId(modelIdValue, props.account)
  const duplicateModelId = customModelId !== null && catalog.some(model => model.id === customModelId)
  const listed = modelOrder.filter(id => catalog.some(model => model.id === id))
  const ordered = [
    ...listed.map(id => catalog.find(model => model.id === id)).filter(model => model !== undefined),
    ...catalog.filter(model => !listed.includes(model.id)),
  ]
  const hidden = new Set(hiddenModelIds)
  const favorites = new Set(favoriteModelIds)
  const favoriteModels = ordered.filter(model => favorites.has(model.id) && !hidden.has(model.id))
  const availableModels = ordered.filter(model => !hidden.has(model.id) && !favorites.has(model.id))
  const hiddenModels = ordered.filter(model => hidden.has(model.id))
  const allHidden = ordered.length > 0 && ordered.every(model => hidden.has(model.id))

  const addModel = (): void => {
    if (customModelId === null || duplicateModelId) return
    props.onChange({ additionalModelIds: [...new Set([...additionalModelIds, customModelId])] })
    setModelIdInput({ instanceId: props.account.instanceId, value: '' })
  }

  const move = (id: string, delta: number): void => {
    const next = ordered.map(model => model.id)
    const index = next.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    props.onChange({ modelOrder: next })
  }

  const toggleFavorite = (modelId: string): void => {
    props.onChange(
      ModelCurationModel.toggleFavoriteModel({
        modelId,
        orderedModelIds: ordered.map(model => model.id),
        favoriteModelIds,
        hiddenModelIds,
      }),
    )
  }

  const toggleHidden = (modelId: string): void => {
    const next = new Set(hiddenModelIds)
    if (next.has(modelId)) next.delete(modelId)
    else next.add(modelId)
    props.onChange({ hiddenModelIds: [...next] })
  }

  const setEffort = (modelId: string, effortId: string): void => {
    const next = { ...reasoningDefaults }
    if (effortId === PROVIDER_DEFAULT) delete next[modelId]
    else next[modelId] = effortId
    props.onChange({ reasoningDefaults: next })
  }

  const toggleAll = (): void => {
    if (allHidden) {
      props.onChange({ hiddenModelIds: hiddenModelIds.filter(id => !catalog.some(model => model.id === id)) })
      return
    }
    props.onChange({ hiddenModelIds: [...new Set([...hiddenModelIds, ...ordered.map(model => model.id)])] })
  }

  const matchesSearch = (model: CatalogModel): boolean => `${model.name} ${model.id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
  const rows = (models: readonly CatalogModel[]): JSX.Element[] =>
    models.filter(matchesSearch).map(model => {
      const groupIndex = models.indexOf(model)
      const isFavorite = favorites.has(model.id)
      const isHidden = hidden.has(model.id)
      const pinned = reasoningDefaults[model.id]
      return (
        <li
          className={cn(
            'dshx:flex dshx:min-w-0 dshx:min-h-12 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:py-2 dshx:hover:bg-accent/50 dshx:@max-pane-narrow:flex-wrap',
            isHidden && 'dshx:opacity-50',
          )}
          key={model.id}
        >
          <Button
            aria-label={isFavorite ? `Unstar ${model.name}` : `Star ${model.name}`}
            aria-pressed={isFavorite}
            className={cn(isFavorite ? 'dshx:text-warning' : 'dshx:text-muted-foreground')}
            onClick={() => toggleFavorite(model.id)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <StarIcon className={cn(isFavorite && 'dshx:fill-current')} />
          </Button>
          <ActionHint label={model.id}>
            <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5" tabIndex={0}>
              <strong className="dshx:truncate dshx:text-sm dshx:font-medium">{model.name}</strong>
              <small className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground dshx:@max-pane-narrow:hidden">{model.id}</small>
            </span>
          </ActionHint>
          <span className="dshx:flex dshx:min-w-0 dshx:flex-none dshx:items-center dshx:gap-1 dshx:@max-pane-narrow:ml-8 dshx:@max-pane-narrow:w-[calc(100%-2rem)] dshx:@max-pane-narrow:flex-wrap">
            {model.efforts.length === 0 ? null : (
              <Combobox
                label={`Default reasoning effort for ${model.name}`}
                onValueChange={effortId => setEffort(model.id, effortId)}
                options={[{ value: PROVIDER_DEFAULT, label: 'Provider default' }, ...model.efforts.map(effort => ({ value: effort.id, label: effort.name }))]}
                triggerClassName="dshx:h-7 dshx:w-32 dshx:text-xs"
                value={pinned ?? PROVIDER_DEFAULT}
              />
            )}
            <Button
              aria-label={`Move ${model.name} up`}
              disabled={groupIndex === 0}
              onClick={() => move(model.id, -1)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <ChevronUpIcon />
            </Button>
            <Button
              aria-label={`Move ${model.name} down`}
              disabled={groupIndex === models.length - 1}
              onClick={() => move(model.id, 1)}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <ChevronDownIcon />
            </Button>
            <Button
              aria-label={isHidden ? `Show ${model.name} in the picker` : `Hide ${model.name} from the picker`}
              aria-pressed={!isHidden}
              className="dshx:w-12"
              onClick={() => toggleHidden(model.id)}
              size="xs"
              type="button"
              variant="outline"
            >
              {isHidden ? 'Show' : 'Hide'}
            </Button>
          </span>
        </li>
      )
    })

  const groups: readonly { readonly title: string; readonly models: readonly CatalogModel[] }[] = [
    { title: 'Favorites', models: favoriteModels },
    { title: 'All', models: availableModels },
    { title: 'Hidden from picker', models: hiddenModels },
  ]

  return (
    <div className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-muted/20 dshx:p-3">
      <Input
        aria-label="Search models"
        onChange={event => setSearch(event.target.value)}
        placeholder="Search this account’s models…"
        type="search"
        value={search}
      />
      <form
        className="dshx:flex dshx:gap-2"
        onSubmit={event => {
          event.preventDefault()
          addModel()
        }}
      >
        <Input
          aria-label="Additional model ID"
          className="dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:font-mono! dshx:text-xs"
          maxLength={120}
          onChange={event => setModelIdInput({ instanceId: props.account.instanceId, value: event.target.value })}
          placeholder={props.account.kind === 'opencode-go' ? 'opencode-go/step-5-preview-free' : 'provider/model-id'}
          value={modelIdValue}
        />
        <Button className="dshx:shrink" disabled={customModelId === null || duplicateModelId} size="sm" type="submit" variant="outline">
          <PlusIcon />
          Add model
        </Button>
      </form>
      <p className="dshx:px-1.5 dshx:text-xs dshx:text-muted-foreground">
        Add an ID the provider catalog does not return. The account/provider prefix is optional.
      </p>
      <div className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2.5 dshx:px-1.5 dshx:pb-1 dshx:text-xs dshx:text-muted-foreground">
        <span className="dshx:flex-1">
          {ordered.length} models · {favoriteModels.length} favorites · {hiddenModels.length} hidden
        </span>
        <Button onClick={toggleAll} size="xs" type="button" variant="outline">
          {allHidden ? 'Enable all' : 'Disable all'}
        </Button>
      </div>
      {ordered.length === 0 ? (
        <Empty className="dshx:gap-2 dshx:p-4">
          <EmptyDescription className="dshx:text-xs">No models returned yet. Sign in, then refresh the provider catalog.</EmptyDescription>
        </Empty>
      ) : null}
      {ordered.length > 0 && !ordered.some(matchesSearch) ? (
        <p className="dshx:py-4 dshx:text-sm dshx:text-muted-foreground" role="status">
          No models match this search.
        </p>
      ) : null}
      {groups.map(group =>
        !group.models.some(matchesSearch) ? null : (
          <section key={group.title}>
            <h4 className="dshx:px-1.5 dshx:pt-1.5 dshx:pb-1 dshx:text-xs dshx:text-muted-foreground">{group.title}</h4>
            <ul>{rows(group.models)}</ul>
          </section>
        ),
      )}
    </div>
  )
}
