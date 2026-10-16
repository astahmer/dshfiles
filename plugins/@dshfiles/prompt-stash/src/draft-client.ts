import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { promptStashApi } from './library-api.js'
import { DRAFT_STORE_KEY, LEGACY_DRAFT_STORE_KEY, readStoredDrafts, removeDraft, saveDraft, type SavedDraft, type SaveDraftResult } from './draft-store.js'

export type SavedDraftsState = 'loading' | 'ready' | 'unavailable'
export type DraftRejectionReason = Extract<SaveDraftResult, { ok: false }>['reason']

export type DraftSaveOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'rejected'; readonly reason: DraftRejectionReason }
  | { readonly kind: 'unavailable' }

export interface SavedDraftsClient {
  readonly state: SavedDraftsState
  readonly drafts: readonly SavedDraft[]
  readonly save: (draft: { readonly id: string; readonly title: string; readonly text: string; readonly now: string }) => Promise<DraftSaveOutcome>
  readonly remove: (id: string) => Promise<boolean>
  readonly refresh: () => void
}

type LocalDraftRead = { readonly kind: 'ready'; readonly drafts: readonly SavedDraft[] } | { readonly kind: 'unavailable' }

const readLocalDrafts = (): LocalDraftRead => {
  try {
    return { kind: 'ready', drafts: readStoredDrafts(window.localStorage).drafts }
  } catch {
    return { kind: 'unavailable' }
  }
}

const writeLocalDrafts = (serialized: string): boolean => {
  try {
    window.localStorage.setItem(DRAFT_STORE_KEY, serialized)
    return true
  } catch {
    return false
  }
}

const clearLocalDrafts = (): void => {
  try {
    window.localStorage.removeItem(DRAFT_STORE_KEY)
    window.localStorage.removeItem(LEGACY_DRAFT_STORE_KEY)
  } catch {
    return
  }
}

/**
 * The shared saved drafts. The Host owns them; browser storage stays the
 * fallback only while the API is unavailable, and its content moves to the
 * Host once on first load.
 */
export const useSavedDrafts = (): SavedDraftsClient => {
  const api = useApi(promptStashApi)
  const query = useApiQuery(promptStashApi, 'drafts')
  const [state, setState] = useState<SavedDraftsState>('loading')
  const [drafts, setDrafts] = useState<readonly SavedDraft[]>([])
  const host = useRef(false)
  const revision = useRef(0)
  const migrated = useRef(false)
  const refetch = query.refetch

  const adopt = useCallback((snapshot: { readonly revision: number; readonly drafts: readonly SavedDraft[] }) => {
    if (snapshot.revision < revision.current) return
    revision.current = snapshot.revision
    setDrafts(snapshot.drafts)
  }, [])

  useEffect(() => {
    if (query.data !== undefined) {
      host.current = true
      adopt(query.data)
      setState('ready')
      if (migrated.current) return
      migrated.current = true
      void (async () => {
        const local = readLocalDrafts()
        let migratedAll = local.kind === 'ready'
        if (local.kind === 'ready') {
          for (const draft of local.drafts) {
            const result = await api.saveDraft({ draft: { id: draft.id, title: draft.title, text: draft.text, now: draft.updatedAt } })
            if (result.kind === 'rejected' && result.reason !== 'duplicate-id') migratedAll = false
          }
        }
        if (migratedAll) clearLocalDrafts()
        refetch()
      })().catch(() => {
        migrated.current = false
      })
      return
    }
    if (query.error !== null) {
      host.current = false
      revision.current = 0
      const local = readLocalDrafts()
      setDrafts(local.kind === 'ready' ? local.drafts : [])
      setState(local.kind === 'ready' ? 'ready' : 'unavailable')
    }
  }, [adopt, api, query.data, query.error, refetch])

  const save = useCallback(
    async (draft: { readonly id: string; readonly title: string; readonly text: string; readonly now: string }): Promise<DraftSaveOutcome> => {
      if (host.current) {
        try {
          const result = await api.saveDraft({ draft })
          adopt(result)
          setState('ready')
          return result.kind === 'applied' ? { kind: 'applied' } : { kind: 'rejected', reason: result.reason }
        } catch {
          setState('unavailable')
          return { kind: 'unavailable' }
        }
      }
      const local = readLocalDrafts()
      if (local.kind !== 'ready') {
        setState('unavailable')
        return { kind: 'unavailable' }
      }
      const result = saveDraft({ schemaVersion: 1, drafts: [...local.drafts] }, draft)
      if (!result.ok) return { kind: 'rejected', reason: result.reason }
      if (!writeLocalDrafts(result.serialized)) {
        setState('unavailable')
        return { kind: 'unavailable' }
      }
      setDrafts(result.store.drafts)
      return { kind: 'applied' }
    },
    [adopt, api],
  )

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (host.current) {
        try {
          const result = await api.removeDraft({ id })
          adopt(result)
          setState('ready')
          return true
        } catch {
          setState('unavailable')
          return false
        }
      }
      const local = readLocalDrafts()
      if (local.kind !== 'ready') {
        setState('unavailable')
        return false
      }
      const next = removeDraft({ schemaVersion: 1, drafts: [...local.drafts] }, id)
      if (!writeLocalDrafts(JSON.stringify(next))) {
        setState('unavailable')
        return false
      }
      setDrafts(next.drafts)
      return true
    },
    [adopt, api],
  )

  return { state, drafts, save, remove, refresh: refetch }
}
