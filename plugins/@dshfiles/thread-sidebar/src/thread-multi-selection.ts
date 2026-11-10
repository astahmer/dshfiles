import { useMemo, useSyncExternalStore } from 'react'

/**
 * The sidebar's multi-selection as rows read it: each row subscribes to its own membership, so a toggle re-renders only
 * the rows whose selected state changed, without the list re-rendering every row.
 */
export interface ThreadMultiSelectionStore {
  readonly has: (sessionId: string) => boolean
  readonly set: (sessionIds: readonly string[]) => void
  readonly subscribe: (listener: () => void) => () => void
}

export const createThreadMultiSelectionStore = (): ThreadMultiSelectionStore => {
  let selected: ReadonlySet<string> = new Set()
  const listeners = new Set<() => void>()
  return {
    has: sessionId => selected.has(sessionId),
    set: sessionIds => {
      const next = new Set(sessionIds)
      if (next.size === selected.size && [...next].every(sessionId => selected.has(sessionId))) return
      selected = next
      for (const listener of listeners) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Whether one row is part of the sidebar's multi-selection. */
export const useThreadMultiSelected = (store: ThreadMultiSelectionStore, sessionId: string): boolean => {
  const read = (): boolean => store.has(sessionId)
  return useSyncExternalStore(store.subscribe, read, read)
}

/** The selected ones among a list's rows (a parent's child threads), re-rendering only when that subset changes. */
export const useThreadMultiSelectedIds = (store: ThreadMultiSelectionStore, sessionIds: readonly string[]): ReadonlySet<string> => {
  const read = (): string => sessionIds.filter(sessionId => store.has(sessionId)).join('\n')
  const key = useSyncExternalStore(store.subscribe, read, read)
  return useMemo(() => new Set(key === '' ? [] : key.split('\n')), [key])
}
