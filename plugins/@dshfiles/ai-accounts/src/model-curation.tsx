import type { AccountDraft } from './api.js'
import styles from './accounts.module.css'

/**
 * Model curation: favorite, hide, and reorder an account's models.
 *
 * Reordering is explicit rather than a full sort, so a model the provider adds
 * later appears after the curated ones instead of displacing them. The rows are
 * split into Favorites, All, and Hidden groups so a long catalog stays readable.
 */
export const ModelCuration = (props: {
  readonly account: AccountDraft
  readonly catalog: readonly { id: string; name: string; efforts: readonly { id: string; name: string }[]; defaultEffort: string | null }[]
  readonly onChange: (next: Partial<AccountDraft>) => void
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

  const move = (id: string, delta: number) => {
    const next = ordered.map(model => model.id)
    const index = next.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= next.length) return
    const [moved] = next.splice(index, 1)
    if (moved === undefined) return
    next.splice(target, 0, moved)
    props.onChange({ modelOrder: next })
  }

  const toggleFavorite = (modelId: string) => {
    const nextFavorites = new Set(favoriteModelIds)
    if (nextFavorites.has(modelId)) nextFavorites.delete(modelId)
    else nextFavorites.add(modelId)
    const favoritesFirst = ordered.filter(model => nextFavorites.has(model.id)).map(model => model.id)
    const rest = ordered.filter(model => !nextFavorites.has(model.id)).map(model => model.id)
    props.onChange({ favoriteModelIds: [...nextFavorites], modelOrder: [...favoritesFirst, ...rest] })
  }

  const toggleHidden = (modelId: string) => {
    const next = new Set(hiddenModelIds)
    if (next.has(modelId)) next.delete(modelId)
    else next.add(modelId)
    props.onChange({ hiddenModelIds: [...next] })
  }

  const setEffort = (modelId: string, effortId: string) => {
    const next = { ...reasoningDefaults }
    if (effortId === '') delete next[modelId]
    else next[modelId] = effortId
    props.onChange({ reasoningDefaults: next })
  }

  const rows = (models: readonly { id: string; name: string; efforts: readonly { id: string; name: string }[]; defaultEffort: string | null }[]) =>
    models.map(model => {
      const isFavorite = favorites.has(model.id)
      const isHidden = hidden.has(model.id)
      const groupIndex = models.findIndex(candidate => candidate.id === model.id)
      return (
        <li className={isHidden ? `${styles.modelRow} ${styles.modelRowHidden}` : styles.modelRow} key={model.id}>
          <button
            type="button"
            className={isFavorite ? styles.starOn : styles.starOff}
            aria-label={isFavorite ? `Unstar ${model.name}` : `Star ${model.name}`}
            aria-pressed={isFavorite}
            onClick={() => toggleFavorite(model.id)}
          >
            ★
          </button>
          <span className={styles.modelName} title={model.id}>
            <strong>{model.name}</strong>
            <small>{model.id}</small>
          </span>
          <span className={styles.modelActions}>
            {model.efforts.length === 0 ? null : (
              <select
                className={styles.reasoningSelect}
                aria-label={`Default reasoning effort for ${model.name}`}
                value={reasoningDefaults[model.id] ?? model.defaultEffort ?? ''}
                onChange={event => setEffort(model.id, event.target.value)}
              >
                {model.defaultEffort === null || reasoningDefaults[model.id] !== undefined ? null : <option value="">Provider default</option>}
                {model.efforts.map(effort => (
                  <option key={effort.id} value={effort.id}>
                    {effort.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className={styles.moveButton}
              aria-label={`Move ${model.name} up`}
              disabled={groupIndex === 0}
              onClick={() => move(model.id, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className={styles.moveButton}
              aria-label={`Move ${model.name} down`}
              disabled={groupIndex === models.length - 1}
              onClick={() => move(model.id, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className={styles.moveButton}
              aria-pressed={!isHidden}
              aria-label={isHidden ? `Show ${model.name} in the picker` : `Hide ${model.name} from the picker`}
              onClick={() => toggleHidden(model.id)}
            >
              {isHidden ? 'Show' : 'Hide'}
            </button>
          </span>
        </li>
      )
    })

  const toggleAll = () => {
    if (allHidden) {
      props.onChange({ hiddenModelIds: hiddenModelIds.filter(id => !props.catalog.some(model => model.id === id)) })
      return
    }
    props.onChange({ hiddenModelIds: [...new Set([...hiddenModelIds, ...ordered.map(model => model.id)])] })
  }

  return (
    <div className={styles.curation}>
      <div className={styles.modelToolbar}>
        <button type="button" className={styles.quiet} onClick={toggleAll}>
          {allHidden ? 'Enable all' : 'Disable all'}
        </button>
        <span className={styles.modelCount}>
          {ordered.length} models · {favoriteModels.length} favorites · {hiddenModels.length} hidden
        </span>
      </div>
      {ordered.length === 0 ? <p className={styles.empty}>No models returned yet. Sign in, then refresh the provider catalog.</p> : null}
      {favoriteModels.length > 0 ? (
        <>
          <h4 className={styles.modelGroup}>Favorites</h4>
          <ul className={styles.modelList}>{rows(favoriteModels)}</ul>
        </>
      ) : null}
      {availableModels.length > 0 ? (
        <>
          <h4 className={styles.modelGroup}>All</h4>
          <ul className={styles.modelList}>{rows(availableModels)}</ul>
        </>
      ) : null}
      {hiddenModels.length > 0 ? (
        <>
          <h4 className={styles.modelGroup}>Hidden from picker</h4>
          <ul className={styles.modelList}>{rows(hiddenModels)}</ul>
        </>
      ) : null}
    </div>
  )
}
