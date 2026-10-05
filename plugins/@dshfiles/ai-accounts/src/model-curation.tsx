import {
  Button,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconPinFillRegular,
  IconPinOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { EmptyState, Select, type SelectOption } from '@dshfiles/plugin-ui'
import type { AccountDraft, AccountsCatalog } from './api.js'
import styles from './accounts.module.css'

type CatalogModel = AccountsCatalog['models'][number]

export type CurationPatch = Partial<Pick<AccountDraft, 'hiddenModelIds' | 'favoriteModelIds' | 'modelOrder' | 'reasoningDefaults'>>

const effortOptions = (model: CatalogModel, pinned: string | undefined): readonly SelectOption<string>[] => [
  ...(model.defaultEffort === null || pinned !== undefined ? [] : [{ value: '', label: 'Provider default' }]),
  ...model.efforts.map(effort => ({ value: effort.id, label: effort.name })),
]

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
    if (effortId === '') delete next[modelId]
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
      return (
        <li className={isHidden ? `${styles.modelRow} ${styles.modelRowHidden}` : styles.modelRow} key={model.id}>
          <Button
            aria-label={isFavorite ? `Unstar ${model.name}` : `Star ${model.name}`}
            aria-pressed={isFavorite}
            icon={isFavorite ? <IconPinFillRegular /> : <IconPinOutlineRegular />}
            onClick={() => toggleFavorite(model.id)}
            size="sm"
            type="button"
          />
          <span className={styles.modelName} title={model.id}>
            <strong>{model.name}</strong>
            <small>{model.id}</small>
          </span>
          <span className={styles.modelActions}>
            {model.efforts.length === 0 ? null : (
              <Select
                aria-label={`Default reasoning effort for ${model.name}`}
                className={styles.compactSelect}
                onValueChange={effortId => setEffort(model.id, effortId)}
                options={effortOptions(model, reasoningDefaults[model.id])}
                value={reasoningDefaults[model.id] ?? model.defaultEffort ?? ''}
              />
            )}
            <Button
              aria-label={`Move ${model.name} up`}
              disabled={groupIndex === 0}
              icon={<IconChevronUpOutlineRegular />}
              onClick={() => move(model.id, -1)}
              size="sm"
              type="button"
            />
            <Button
              aria-label={`Move ${model.name} down`}
              disabled={groupIndex === models.length - 1}
              icon={<IconChevronDownOutlineRegular />}
              onClick={() => move(model.id, 1)}
              size="sm"
              type="button"
            />
            <Button
              aria-label={isHidden ? `Show ${model.name} in the picker` : `Hide ${model.name} from the picker`}
              aria-pressed={!isHidden}
              onClick={() => toggleHidden(model.id)}
              size="sm"
              type="button"
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
    <div className={styles.inset}>
      <div className={styles.modelToolbar}>
        <span>
          {ordered.length} models · {favoriteModels.length} favorites · {hiddenModels.length} hidden
        </span>
        <Button onClick={toggleAll} size="sm" type="button" variant="outline">
          {allHidden ? 'Enable all' : 'Disable all'}
        </Button>
      </div>
      {ordered.length === 0 ? <EmptyState compact description="No models returned yet. Sign in, then refresh the provider catalog." /> : null}
      {groups.map(group =>
        group.models.length === 0 ? null : (
          <section key={group.title}>
            <h4 className={styles.modelGroup}>{group.title}</h4>
            <ul className={styles.modelList}>{rows(group.models)}</ul>
          </section>
        ),
      )}
    </div>
  )
}
