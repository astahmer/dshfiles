import { useSyncExternalStore } from 'react'
import { workbenchTabs } from './tabs.js'

/** Two projects open the same semantic tab id, so the Workbench scope key joins the panel id. */
export const panelOccurrence = (input: { readonly panelId: string; readonly scopeKey?: string | undefined }): string =>
  `${input.scopeKey ?? workbenchTabs().getSnapshot().scopeKey}/${input.panelId}`

/** The current Workbench scope, so a panel re-keys its occurrence when the project scope switches. */
export const useWorkbenchScopeKey = (): string => {
  const tabs = workbenchTabs()
  const read = (): string => tabs.getSnapshot().scopeKey
  return useSyncExternalStore(tabs.subscribe, read, read)
}

const inheritFirstSaved = (key: string, legacyKeys: readonly string[]): void => {
  try {
    const storage = globalThis.localStorage
    if (storage.getItem(key) !== null) return
    for (const legacyKey of legacyKeys) {
      const saved = storage.getItem(legacyKey)
      if (saved === null) continue
      storage.setItem(key, saved)
      return
    }
  } catch {
    // Storage refused (private mode or quota): the stored value falls back on its own.
  }
}

/**
 * The localStorage key one panel occurrence keeps its presentation state under. A key read for the first time inherits
 * the first saved legacy key: by default the one the panel used before occurrences included the Workbench scope.
 */
export const panelOccurrenceStorageKey = (input: {
  readonly base: string
  readonly panelId: string
  readonly scopeKey?: string | undefined
  readonly legacyKeys?: readonly string[]
}): string => {
  const key = `${input.base}/panel/${encodeURIComponent(panelOccurrence(input))}`
  inheritFirstSaved(key, input.legacyKeys ?? [`${input.base}/panel/${encodeURIComponent(input.panelId)}`])
  return key
}
