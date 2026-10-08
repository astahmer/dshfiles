import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Empty, EmptyDescription } from '@dshfiles/plugin-ui/components/ui/empty'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dshfiles/plugin-ui/components/ui/select'
import { ChevronDownIcon, ChevronUpIcon, StarIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { AccountDraft, AccountsCatalog } from './api.js'

type CatalogModel = AccountsCatalog['models'][number]

export type CurationPatch = Partial<Pick<AccountDraft, 'hiddenModelIds' | 'favoriteModelIds' | 'modelOrder' | 'reasoningDefaults'>>

/** Radix Select reserves the empty string, so "no pinned effort" travels under its own value. */
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
  const { hiddenModelIds, favoriteModelIds, modelOrder, reasoningDefaults } = props.account
  const listed = modelOrder.filter(id => props.catalog.some(model => model.id === id))
  const ordered = [
    ...listed.map(id => props.catalog.find(model => model.id === id)).filter(model => model !== undefined),
    ...props.catalog.filter(model => !listed.includes(model.id)),
  ]
  const hidden = new Set(hiddenModelIds)
  const favorites = new Set(favoriteModelIds)
  const favoriteModels = ordered.filter(model => favorites.has(model.id) && !hidden.has(model.id))
  const availableModels = ordered.filter(model => !hidden.has(model.id) && !favorites.has(model.id))
  const hiddenModels = ordered.filter(model => hidden.has(model.id))
  const allHidden = ordered.length > 0 && ordered.every(model => hidden.has(model.id))

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
    const nextFavorites = new Set(favoriteModelIds)
    if (nextFavorites.has(modelId)) nextFavorites.delete(modelId)
    else nextFavorites.add(modelId)
    const favoritesFirst = ordered.filter(model => nextFavorites.has(model.id)).map(model => model.id)
    const rest = ordered.filter(model => !nextFavorites.has(model.id)).map(model => model.id)
    props.onChange({ favoriteModelIds: [...nextFavorites], modelOrder: [...favoritesFirst, ...rest] })
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
      props.onChange({ hiddenModelIds: hiddenModelIds.filter(id => !props.catalog.some(model => model.id === id)) })
      return
    }
    props.onChange({ hiddenModelIds: [...new Set([...hiddenModelIds, ...ordered.map(model => model.id)])] })
  }

  const rows = (models: readonly CatalogModel[]): JSX.Element[] =>
    models.map((model, groupIndex) => {
      const isFavorite = favorites.has(model.id)
      const isHidden = hidden.has(model.id)
      const pinned = reasoningDefaults[model.id]
      return (
        <li
          className={cn(
            'dshx:flex dshx:min-h-8 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:py-0.5 dshx:hover:bg-accent/50',
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
          <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-baseline dshx:gap-2" title={model.id}>
            <strong className="dshx:truncate dshx:text-sm dshx:font-medium">{model.name}</strong>
            <small className="dshx:truncate dshx:font-mono dshx:text-xs dshx:text-muted-foreground">{model.id}</small>
          </span>
          <span className="dshx:flex dshx:flex-none dshx:items-center dshx:gap-1">
            {model.efforts.length === 0 ? null : (
              <Select onValueChange={effortId => setEffort(model.id, effortId)} value={pinned ?? model.defaultEffort ?? PROVIDER_DEFAULT}>
                <SelectTrigger aria-label={`Default reasoning effort for ${model.name}`} className="dshx:h-6 dshx:min-w-24 dshx:text-xs" size="sm">
                  <SelectValue placeholder="Provider default" />
                </SelectTrigger>
                <SelectContent>
                  {model.defaultEffort === null || pinned !== undefined ? null : <SelectItem value={PROVIDER_DEFAULT}>Provider default</SelectItem>}
                  {model.efforts.map(effort => (
                    <SelectItem key={effort.id} value={effort.id}>
                      {effort.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
    <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:rounded-lg dshx:border dshx:bg-muted/30 dshx:p-2">
      <div className="dshx:flex dshx:items-center dshx:gap-2.5 dshx:px-1.5 dshx:pb-1 dshx:text-xs dshx:text-muted-foreground">
        <span className="dshx:flex-1">
          {ordered.length} models · {favoriteModels.length} favorites · {hiddenModels.length} hidden
        </span>
        <Button onClick={toggleAll} size="xs" type="button" variant="outline">
          {allHidden ? 'Enable all' : 'Disable all'}
        </Button>
      </div>
      {ordered.length === 0 ? (
        <Empty className="dshx:gap-2 dshx:p-4 dshx:md:p-4">
          <EmptyDescription className="dshx:text-xs">No models returned yet. Sign in, then refresh the provider catalog.</EmptyDescription>
        </Empty>
      ) : null}
      {groups.map(group =>
        group.models.length === 0 ? null : (
          <section key={group.title}>
            <h4 className="dshx:px-1.5 dshx:pt-1.5 dshx:pb-1 dshx:text-xs dshx:text-muted-foreground">{group.title}</h4>
            <ul>{rows(group.models)}</ul>
          </section>
        ),
      )}
    </div>
  )
}
