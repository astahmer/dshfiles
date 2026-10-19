import { useApi } from '@dshfiles/dshx/client'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo } from 'react'
import { PromptDraftMigration, type PromptDraftMigrationClient } from './draft-migration-machine.js'
import { PromptDraftQueries } from './draft-queries.js'
import { draftMutationSchema, draftSnapshotSchema, promptStashApi, type DraftMutation, type DraftSnapshot } from './library-api.js'
import { DRAFT_STORE_KEY, PromptDrafts, type DraftStore, type SavedDraft, type SaveDraftResult } from './draft-store.js'

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

type SaveDraftVariables = {
  readonly draft: { readonly id: string; readonly title: string; readonly text: string; readonly now: string }
  readonly signal?: AbortSignal
}

type RemoveDraftVariables = { readonly id: string; readonly signal?: AbortSignal }

let localDraftStorageAvailable = true
let importedLegacySerialized: string | null = null

const withLocalStorage = <Result>(storage: Storage, operation: () => Result): Result => {
  try {
    const result = operation()
    localDraftStorageAvailable = true
    return result
  } catch (error) {
    localDraftStorageAvailable = false
    throw error
  }
}

const localDraftStorage = () => {
  try {
    const storage = window.localStorage
    localDraftStorageAvailable = true
    return {
      getItem: (key: string) =>
        withLocalStorage(storage, () => {
          if (key !== DRAFT_STORE_KEY) return storage.getItem(key)
          const result = PromptDrafts.readStoredWithSource(storage)
          if (result.importedLegacy) importedLegacySerialized = result.legacySerialized
          return JSON.stringify(result.store)
        }),
      setItem: (key: string, value: string) => withLocalStorage(storage, () => storage.setItem(key, value)),
      removeItem: (key: string) => withLocalStorage(storage, () => storage.removeItem(key)),
    }
  } catch {
    localDraftStorageAvailable = false
    return null
  }
}

const storedDrafts = createStoredValue({
  key: DRAFT_STORE_KEY,
  schema: PromptDrafts.schema,
  fallback: PromptDrafts.emptyStore(),
  storage: localDraftStorage,
})

const completeDraftMigration = (expectedStore: DraftStore): void => {
  try {
    PromptDrafts.clearStored(window.localStorage, importedLegacySerialized, expectedStore)
    importedLegacySerialized = null
    localDraftStorageAvailable = true
  } catch {
    localDraftStorageAvailable = false
  }
  storedDrafts.reload()
}

/** The Host snapshot owns shared drafts; this value is only the browser fallback until Host writes succeed. */
export const useSavedDrafts = (): SavedDraftsClient => {
  const api = useApi(promptStashApi)
  const queryClient = useQueryClient()
  const localStore = storedDrafts.useValue()
  const query = useQuery({
    queryKey: PromptDraftQueries.key,
    queryFn: async ({ signal }) =>
      PromptDraftQueries.newest(queryClient.getQueryData<DraftSnapshot>(PromptDraftQueries.key), await api.drafts(undefined, { signal })),
  })
  const saveMutation = useMutation<DraftMutation, Error, SaveDraftVariables>({
    mutationFn: async input =>
      draftMutationSchema.parse(
        await (input.signal === undefined ? api.saveDraft({ draft: input.draft }) : api.saveDraft({ draft: input.draft }, { signal: input.signal })),
      ),
    onSuccess: snapshot => queryClient.setQueryData<DraftSnapshot>(PromptDraftQueries.key, current => PromptDraftQueries.newest(current, snapshot)),
  })
  const removeMutation = useMutation<DraftSnapshot, Error, RemoveDraftVariables>({
    mutationFn: async input =>
      draftSnapshotSchema.parse(
        await (input.signal === undefined ? api.removeDraft({ id: input.id }) : api.removeDraft({ id: input.id }, { signal: input.signal })),
      ),
    onSuccess: snapshot => queryClient.setQueryData<DraftSnapshot>(PromptDraftQueries.key, current => PromptDraftQueries.newest(current, snapshot)),
  })
  const saveDraftMutation = saveMutation.mutateAsync
  const removeDraftMutation = removeMutation.mutateAsync
  const refetchDrafts = query.refetch
  const saveDraftForMigration = useCallback(
    (
      input: { readonly draft: { readonly id: string; readonly title: string; readonly text: string; readonly now: string } },
      options: { readonly signal: AbortSignal },
    ) => saveDraftMutation({ ...input, signal: options.signal }),
    [saveDraftMutation],
  )
  const migrationClient = useMemo<PromptDraftMigrationClient>(
    () => ({
      saveDraft: saveDraftForMigration,
      completeMigration: completeDraftMigration,
      refresh: () => void queryClient.invalidateQueries({ queryKey: PromptDraftQueries.key, exact: true }),
    }),
    [queryClient, saveDraftForMigration],
  )

  useEffect(() => PromptDraftMigration.retain(), [])
  useEffect(() => {
    if (query.data === undefined) return
    PromptDraftMigration.dispatch({ client: migrationClient, snapshot: query.data, localStore })
  }, [localStore, migrationClient, query.data])

  const save = useCallback(
    async (draft: { readonly id: string; readonly title: string; readonly text: string; readonly now: string }): Promise<DraftSaveOutcome> => {
      if (query.data !== undefined) {
        try {
          const result = await saveDraftMutation({ draft })
          return result.kind === 'applied' ? { kind: 'applied' } : { kind: 'rejected', reason: result.reason }
        } catch {
          return { kind: 'unavailable' }
        }
      }

      const result = PromptDrafts.save(localStore, draft)
      if (!result.ok) return { kind: 'rejected', reason: result.reason }
      if (!storedDrafts.set(result.store)) {
        storedDrafts.reload()
        return { kind: 'unavailable' }
      }
      return { kind: 'applied' }
    },
    [localStore, query.data, saveDraftMutation],
  )
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      if (query.data !== undefined) {
        try {
          await removeDraftMutation({ id })
          return true
        } catch {
          return false
        }
      }

      const next = PromptDrafts.remove(localStore, id)
      if (!storedDrafts.set(next)) {
        storedDrafts.reload()
        return false
      }
      return true
    },
    [localStore, query.data, removeDraftMutation],
  )
  const refresh = useCallback(() => {
    storedDrafts.reload()
    void refetchDrafts()
  }, [refetchDrafts])

  const state: SavedDraftsState = query.data !== undefined ? 'ready' : query.isPending ? 'loading' : localDraftStorageAvailable ? 'ready' : 'unavailable'

  return { state, drafts: query.data?.drafts ?? localStore.drafts, save, remove, refresh }
}
