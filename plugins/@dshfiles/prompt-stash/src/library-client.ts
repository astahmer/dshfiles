import { useApi } from '@dshfiles/dshx/client'
import * as Schema from 'effect/Schema'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { PromptLibraryMigration, type PromptLibraryMigrationClient } from './library-migration-machine.js'
import { PromptLibraryQueries } from './library-queries.js'
import { promptStashApi, promptStashMutationSchema, promptStashStateSchema, type PromptStashMutation, type PromptStashSnapshot } from './library-api.js'
import { PROMPT_LIBRARY_LOCAL_STORAGE_KEY, PROMPT_LIBRARY_STORAGE_KEY, PromptLibrary, type PromptLibraryStore, type SavedPrompt } from './library.js'
import { LocalLibraryStore } from './local-library-store.js'

export type PromptLibraryState = 'loading' | 'ready' | 'invalid' | 'unavailable'

export type PromptLibraryMutationKind = 'applied' | 'conflict' | 'limit' | 'unavailable'

export interface PromptLibraryMutation {
  readonly kind: PromptLibraryMutationKind
  readonly prompts: readonly SavedPrompt[]
}

export type PromptLibraryRead =
  | { readonly kind: 'ready'; readonly prompts: readonly SavedPrompt[] }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' }

export interface PromptLibraryClient {
  readonly state: PromptLibraryState
  readonly prompts: readonly SavedPrompt[]
  readonly save: (
    input: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<PromptLibraryMutation>
  readonly remove: (
    input: { readonly id: string; readonly expectedRevision: string },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<PromptLibraryMutation>
  readonly readLatest: (options?: { readonly signal?: AbortSignal }) => Promise<PromptLibraryRead>
  readonly refresh: () => void
  readonly createId: () => string
  readonly now: () => number
}

interface SavePromptVariables {
  readonly prompt: SavedPrompt
  readonly expectedRevision: string | null
  readonly signal?: AbortSignal
}

interface RemovePromptVariables {
  readonly id: string
  readonly expectedRevision: string
  readonly signal?: AbortSignal
}

const localLibraryStore = new LocalLibraryStore()

const localLibraryStorage = () => {
  let storage: Storage
  try {
    storage = window.localStorage
  } catch {
    localLibraryStore.setStatus('unavailable', false)
    return null
  }

  return {
    getItem: (key: string) => {
      try {
        if (key !== PROMPT_LIBRARY_LOCAL_STORAGE_KEY) return storage.getItem(key)
        const serialized = storage.getItem(PROMPT_LIBRARY_LOCAL_STORAGE_KEY)
        return serialized === null
          ? localLibraryStore.readLegacy(storage, PROMPT_LIBRARY_STORAGE_KEY)
          : localLibraryStore.readPrimary(storage, PROMPT_LIBRARY_STORAGE_KEY, serialized)
      } catch (error) {
        localLibraryStore.setStatus('unavailable', false)
        throw error
      }
    },
    setItem: (key: string, value: string) => {
      try {
        storage.setItem(key, value)
        if (key === PROMPT_LIBRARY_LOCAL_STORAGE_KEY) localLibraryStore.write(value)
      } catch (error) {
        localLibraryStore.setStatus(localLibraryStore.getSnapshot().status.read, false)
        throw error
      }
    },
    removeItem: (key: string) => {
      try {
        storage.removeItem(key)
        if (key === PROMPT_LIBRARY_LOCAL_STORAGE_KEY) localLibraryStore.remove()
      } catch (error) {
        localLibraryStore.setStatus(localLibraryStore.getSnapshot().status.read, false)
        throw error
      }
    },
  }
}

const storedLibrary = createStoredValue({
  key: PROMPT_LIBRARY_LOCAL_STORAGE_KEY,
  schema: PromptLibrary.schema,
  fallback: PromptLibrary.emptyStore(),
  storage: localLibraryStorage,
})

const completeLocalLibraryMigration = (expectedStore: PromptLibraryStore): void => {
  let shouldReload = false
  try {
    shouldReload = localLibraryStore.completeMigration({
      storage: window.localStorage,
      primaryKey: PROMPT_LIBRARY_LOCAL_STORAGE_KEY,
      legacyKey: PROMPT_LIBRARY_STORAGE_KEY,
      expectedStore,
    })
  } catch {
    localLibraryStore.setStatus('unavailable', false)
    shouldReload = true
  }
  if (shouldReload) storedLibrary.reload()
}

const createPromptId = (): string => globalThis.crypto.randomUUID()
const nowMilliseconds = (): number => Date.now()

/** 30 s, so switching threads reuses the library instead of asking the Host on every composer mount. */
const LIBRARY_STALE_MS = 30_000

/** The Host snapshot owns the shared library; validated local storage is only the offline/HMR fallback. */
export const usePromptLibrary = (options: { readonly pollWhileOpen: boolean } = { pollWhileOpen: false }): PromptLibraryClient => {
  const api = useApi(promptStashApi)
  const queryClient = useQueryClient()
  const localStore = storedLibrary.useValue()
  const localStatus = useSyncExternalStore(localLibraryStore.subscribe, localLibraryStore.getSnapshot, localLibraryStore.getSnapshot).status
  const query = useQuery({
    queryKey: PromptLibraryQueries.key,
    queryFn: async ({ signal }) =>
      PromptLibraryQueries.newest(
        queryClient.getQueryData<PromptStashSnapshot>(PromptLibraryQueries.key),
        Schema.decodeUnknownSync(promptStashStateSchema, { onExcessProperty: 'error' })(await api.state(undefined, { signal })),
      ),
    refetchInterval: options.pollWhileOpen ? 2_000 : false,
    // Composer controls remount with every thread; this client's own writes update the cache, and an open library polls.
    staleTime: LIBRARY_STALE_MS,
  })
  const saveMutation = useMutation<PromptStashMutation, Error, SavePromptVariables>({
    mutationFn: async input =>
      Schema.decodeUnknownSync(promptStashMutationSchema, { onExcessProperty: 'error' })(
        await (input.signal === undefined
          ? api.save({ prompt: input.prompt, expectedRevision: input.expectedRevision })
          : api.save({ prompt: input.prompt, expectedRevision: input.expectedRevision }, { signal: input.signal })),
      ),
    onSuccess: snapshot => queryClient.setQueryData<PromptStashSnapshot>(PromptLibraryQueries.key, current => PromptLibraryQueries.newest(current, snapshot)),
  })
  const removeMutation = useMutation<PromptStashMutation, Error, RemovePromptVariables>({
    mutationFn: async input =>
      Schema.decodeUnknownSync(promptStashMutationSchema, { onExcessProperty: 'error' })(
        await (input.signal === undefined
          ? api.remove({ id: input.id, expectedRevision: input.expectedRevision })
          : api.remove({ id: input.id, expectedRevision: input.expectedRevision }, { signal: input.signal })),
      ),
    onSuccess: snapshot => queryClient.setQueryData<PromptStashSnapshot>(PromptLibraryQueries.key, current => PromptLibraryQueries.newest(current, snapshot)),
  })
  const savePromptMutation = saveMutation.mutateAsync
  const removePromptMutation = removeMutation.mutateAsync
  const refetchLibrary = query.refetch
  const savePromptForMigration = useCallback(
    (input: { readonly prompt: SavedPrompt; readonly expectedRevision: null }, options: { readonly signal: AbortSignal }) =>
      savePromptMutation({ ...input, signal: options.signal }),
    [savePromptMutation],
  )
  const migrationClient = useMemo<PromptLibraryMigrationClient>(
    () => ({
      savePrompt: savePromptForMigration,
      completeMigration: completeLocalLibraryMigration,
      refresh: () => void queryClient.invalidateQueries({ queryKey: PromptLibraryQueries.key, exact: true }),
    }),
    [queryClient, savePromptForMigration],
  )

  useEffect(() => PromptLibraryMigration.retain(), [])
  useEffect(() => {
    if (query.data === undefined) return
    PromptLibraryMigration.dispatch({
      client: migrationClient,
      snapshot: query.data,
      localStore,
      localStatus: localStatus.read,
    })
  }, [localStatus.read, localStore, migrationClient, query.data])

  const save = useCallback(
    async (
      input: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null },
      options?: { readonly signal?: AbortSignal },
    ): Promise<PromptLibraryMutation> => {
      if (options?.signal?.aborted) return { kind: 'unavailable', prompts: localStore.prompts }
      if (query.data !== undefined) {
        try {
          const variables = options?.signal === undefined ? input : { ...input, signal: options.signal }
          const result = await savePromptMutation(variables)
          return { kind: result.kind, prompts: result.prompts }
        } catch {
          return { kind: 'unavailable', prompts: queryClient.getQueryData<PromptStashSnapshot>(PromptLibraryQueries.key)?.prompts ?? [] }
        }
      }
      if (localStatus.read !== 'ready' || !localStatus.writable) return { kind: 'unavailable', prompts: localStore.prompts }

      const result = PromptLibrary.writeIfCurrent(localStore.prompts, input.prompt, input.expectedRevision)
      if (result.kind === 'conflict') return { kind: 'conflict', prompts: result.prompts }
      if (PromptLibrary.serialize(result.prompts) === null) return { kind: 'limit', prompts: localStore.prompts }
      if (!storedLibrary.set({ version: 1, prompts: [...result.prompts] })) {
        storedLibrary.reload()
        return { kind: 'unavailable', prompts: localStore.prompts }
      }
      return { kind: 'applied', prompts: result.prompts }
    },
    [localStatus, localStore, query.data, queryClient, savePromptMutation],
  )
  const remove = useCallback(
    async (input: { readonly id: string; readonly expectedRevision: string }, options?: { readonly signal?: AbortSignal }): Promise<PromptLibraryMutation> => {
      if (options?.signal?.aborted) return { kind: 'unavailable', prompts: localStore.prompts }
      if (query.data !== undefined) {
        try {
          const variables = options?.signal === undefined ? input : { ...input, signal: options.signal }
          const result = await removePromptMutation(variables)
          return { kind: result.kind, prompts: result.prompts }
        } catch {
          return { kind: 'unavailable', prompts: queryClient.getQueryData<PromptStashSnapshot>(PromptLibraryQueries.key)?.prompts ?? [] }
        }
      }
      if (localStatus.read !== 'ready' || !localStatus.writable) return { kind: 'unavailable', prompts: localStore.prompts }

      const result = PromptLibrary.removeIfCurrent(localStore.prompts, input.id, input.expectedRevision)
      if (result.kind === 'conflict') return { kind: 'conflict', prompts: result.prompts }
      if (!storedLibrary.set({ version: 1, prompts: [...result.prompts] })) {
        storedLibrary.reload()
        return { kind: 'unavailable', prompts: localStore.prompts }
      }
      return { kind: 'applied', prompts: result.prompts }
    },
    [localStatus, localStore, query.data, queryClient, removePromptMutation],
  )
  const readLatest = useCallback(
    async (options?: { readonly signal?: AbortSignal }): Promise<PromptLibraryRead> => {
      if (query.data !== undefined) {
        try {
          const incoming = Schema.decodeUnknownSync(promptStashStateSchema, { onExcessProperty: 'error' })(
            await (options?.signal === undefined ? api.state(undefined) : api.state(undefined, { signal: options.signal })),
          )
          let newest = incoming
          queryClient.setQueryData<PromptStashSnapshot>(PromptLibraryQueries.key, current => {
            newest = PromptLibraryQueries.newest(current, incoming)
            return newest
          })
          return { kind: 'ready', prompts: newest.prompts }
        } catch {
          return { kind: 'unavailable' }
        }
      }
      if (options?.signal?.aborted) return { kind: 'unavailable' }
      if (localStatus.read === 'invalid') return { kind: 'invalid' }
      if (localStatus.read === 'unavailable' || !localStatus.writable) return { kind: 'unavailable' }
      return { kind: 'ready', prompts: localStore.prompts }
    },
    [api, localStatus, localStore, query.data, queryClient],
  )
  const refresh = useCallback(() => void refetchLibrary(), [refetchLibrary])

  const localState: PromptLibraryState =
    localStatus.read === 'invalid' ? 'invalid' : localStatus.read === 'unavailable' || !localStatus.writable ? 'unavailable' : 'ready'
  const state: PromptLibraryState = query.data !== undefined ? 'ready' : query.isPending ? 'loading' : localState

  const prompts = query.data?.prompts ?? localStore.prompts
  return useMemo<PromptLibraryClient>(
    () => ({ state, prompts, save, remove, readLatest, refresh, createId: createPromptId, now: nowMilliseconds }),
    [state, prompts, save, remove, readLatest, refresh],
  )
}
