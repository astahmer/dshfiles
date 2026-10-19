import { useApi } from '@dshfiles/dshx/client'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { PromptLibraryMigration, type PromptLibraryLocalStatus, type PromptLibraryMigrationClient } from './library-migration-machine.js'
import { PromptLibraryQueries } from './library-queries.js'
import { promptStashApi, promptStashMutationSchema, promptStashStateSchema, type PromptStashMutation, type PromptStashSnapshot } from './library-api.js'
import { PROMPT_LIBRARY_LOCAL_STORAGE_KEY, PROMPT_LIBRARY_STORAGE_KEY, PromptLibrary, type PromptLibraryStore, type SavedPrompt } from './library.js'

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
  readonly save: (input: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null }) => Promise<PromptLibraryMutation>
  readonly remove: (input: { readonly id: string; readonly expectedRevision: string }) => Promise<PromptLibraryMutation>
  readonly readLatest: () => Promise<PromptLibraryRead>
  readonly refresh: () => void
  readonly createId: () => string
  readonly now: () => number
}

interface LocalLibraryStatus {
  readonly read: PromptLibraryLocalStatus
  readonly writable: boolean
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

let localLibraryStatus: LocalLibraryStatus = { read: 'ready', writable: true }
let localLibrarySerializedFingerprint: string | null = null
let localLibraryStoreFingerprint: string | null = null
let importedLegacySerialized: string | null = null
let importedLegacyStoreFingerprint: string | null = null
let legacyLibraryUnresolved = false
const localLibraryStatusListeners = new Set<() => void>()

const setLocalLibraryStatus = (read: PromptLibraryLocalStatus, writable: boolean): void => {
  if (localLibraryStatus.read === read && localLibraryStatus.writable === writable) return
  localLibraryStatus = { read, writable }
  for (const listener of localLibraryStatusListeners) listener()
}

const subscribeLocalLibraryStatus = (listener: () => void): (() => void) => {
  localLibraryStatusListeners.add(listener)
  return () => localLibraryStatusListeners.delete(listener)
}

const getLocalLibraryStatus = (): LocalLibraryStatus => localLibraryStatus

const useLocalLibraryStatus = (): LocalLibraryStatus => useSyncExternalStore(subscribeLocalLibraryStatus, getLocalLibraryStatus, getLocalLibraryStatus)

const readLegacyLibrary = (storage: Storage): string => {
  const serialized = storage.getItem(PROMPT_LIBRARY_STORAGE_KEY)
  const result = PromptLibrary.readStoredWithSource(serialized)
  if (result.kind === 'library' && serialized !== null) {
    importedLegacySerialized = serialized
    importedLegacyStoreFingerprint = JSON.stringify(result.store)
    localLibraryStoreFingerprint = importedLegacyStoreFingerprint
    localLibrarySerializedFingerprint = null
    legacyLibraryUnresolved = false
    setLocalLibraryStatus('ready', localLibraryStatus.writable)
    return JSON.stringify(result.store)
  }
  importedLegacySerialized = null
  importedLegacyStoreFingerprint = null
  localLibrarySerializedFingerprint = null
  localLibraryStoreFingerprint = null
  legacyLibraryUnresolved = result.kind === 'invalid'
  setLocalLibraryStatus(result.kind === 'invalid' ? 'invalid' : 'ready', localLibraryStatus.writable)
  return result.kind === 'invalid' && serialized !== null ? serialized : JSON.stringify(PromptLibrary.emptyStore())
}

const readPrimaryLibrary = (storage: Storage, serialized: string): string => {
  const result = PromptLibrary.readStoredWithSource(serialized)
  if (result.kind !== 'library') {
    localLibrarySerializedFingerprint = null
    localLibraryStoreFingerprint = null
    legacyLibraryUnresolved = result.kind !== 'legacy-drafts'
    setLocalLibraryStatus('invalid', localLibraryStatus.writable)
    return serialized
  }

  localLibrarySerializedFingerprint = serialized
  localLibraryStoreFingerprint = JSON.stringify(result.store)
  const legacySerialized = storage.getItem(PROMPT_LIBRARY_STORAGE_KEY)
  const legacy = PromptLibrary.readStoredWithSource(legacySerialized)
  if (legacy.kind === 'library' && legacySerialized !== null) {
    importedLegacySerialized = legacySerialized
    importedLegacyStoreFingerprint = JSON.stringify(legacy.store)
    legacyLibraryUnresolved = importedLegacyStoreFingerprint !== localLibraryStoreFingerprint
  } else {
    importedLegacySerialized = null
    importedLegacyStoreFingerprint = null
    legacyLibraryUnresolved = legacy.kind === 'invalid'
  }
  setLocalLibraryStatus('ready', localLibraryStatus.writable)
  return JSON.stringify(result.store)
}

const localLibraryStorage = () => {
  let storage: Storage
  try {
    storage = window.localStorage
  } catch {
    setLocalLibraryStatus('unavailable', false)
    return null
  }

  return {
    getItem: (key: string) => {
      try {
        if (key !== PROMPT_LIBRARY_LOCAL_STORAGE_KEY) return storage.getItem(key)
        const serialized = storage.getItem(PROMPT_LIBRARY_LOCAL_STORAGE_KEY)
        return serialized === null ? readLegacyLibrary(storage) : readPrimaryLibrary(storage, serialized)
      } catch (error) {
        setLocalLibraryStatus('unavailable', false)
        throw error
      }
    },
    setItem: (key: string, value: string) => {
      try {
        storage.setItem(key, value)
        if (key === PROMPT_LIBRARY_LOCAL_STORAGE_KEY) {
          localLibrarySerializedFingerprint = value
          localLibraryStoreFingerprint = value
          legacyLibraryUnresolved = importedLegacySerialized !== null && importedLegacyStoreFingerprint !== value
          setLocalLibraryStatus('ready', true)
        }
      } catch (error) {
        setLocalLibraryStatus(localLibraryStatus.read, false)
        throw error
      }
    },
    removeItem: (key: string) => {
      try {
        storage.removeItem(key)
        if (key === PROMPT_LIBRARY_LOCAL_STORAGE_KEY) {
          localLibrarySerializedFingerprint = null
          localLibraryStoreFingerprint = null
          setLocalLibraryStatus('ready', true)
        }
      } catch (error) {
        setLocalLibraryStatus(localLibraryStatus.read, false)
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
    const storage = window.localStorage
    const legacyCleared =
      importedLegacySerialized !== null &&
      PromptLibrary.clearStoredIfUnchanged({
        storage,
        key: PROMPT_LIBRARY_STORAGE_KEY,
        serialized: importedLegacySerialized,
        storeFingerprint: importedLegacyStoreFingerprint,
        expectedStore,
      })
    if (legacyCleared) {
      shouldReload = true
      importedLegacySerialized = null
      importedLegacyStoreFingerprint = null
      legacyLibraryUnresolved = false
    }

    if (!legacyLibraryUnresolved && (importedLegacySerialized === null || legacyCleared)) {
      const localCleared = PromptLibrary.clearStoredIfUnchanged({
        storage,
        key: PROMPT_LIBRARY_LOCAL_STORAGE_KEY,
        serialized: localLibrarySerializedFingerprint,
        storeFingerprint: localLibraryStoreFingerprint,
        expectedStore,
      })
      if (localCleared) {
        shouldReload = true
        localLibrarySerializedFingerprint = null
        localLibraryStoreFingerprint = null
      }
    }
    setLocalLibraryStatus('ready', true)
  } catch {
    setLocalLibraryStatus('unavailable', false)
    shouldReload = true
  }
  if (shouldReload) storedLibrary.reload()
}

const createPromptId = (): string => globalThis.crypto.randomUUID()
const nowMilliseconds = (): number => Date.now()

/** The Host snapshot owns the shared library; validated local storage is only the offline/HMR fallback. */
export const usePromptLibrary = (options: { readonly pollWhileOpen: boolean } = { pollWhileOpen: false }): PromptLibraryClient => {
  const api = useApi(promptStashApi)
  const queryClient = useQueryClient()
  const localStore = storedLibrary.useValue()
  const localStatus = useLocalLibraryStatus()
  const query = useQuery({
    queryKey: PromptLibraryQueries.key,
    queryFn: async ({ signal }) =>
      PromptLibraryQueries.newest(
        queryClient.getQueryData<PromptStashSnapshot>(PromptLibraryQueries.key),
        promptStashStateSchema.parse(await api.state(undefined, { signal })),
      ),
    refetchInterval: options.pollWhileOpen ? 2_000 : false,
  })
  const saveMutation = useMutation<PromptStashMutation, Error, SavePromptVariables>({
    mutationFn: async input =>
      promptStashMutationSchema.parse(
        await (input.signal === undefined
          ? api.save({ prompt: input.prompt, expectedRevision: input.expectedRevision })
          : api.save({ prompt: input.prompt, expectedRevision: input.expectedRevision }, { signal: input.signal })),
      ),
    onSuccess: snapshot => queryClient.setQueryData<PromptStashSnapshot>(PromptLibraryQueries.key, current => PromptLibraryQueries.newest(current, snapshot)),
  })
  const removeMutation = useMutation<PromptStashMutation, Error, RemovePromptVariables>({
    mutationFn: async input =>
      promptStashMutationSchema.parse(
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
    async (input: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null }): Promise<PromptLibraryMutation> => {
      if (query.data !== undefined) {
        try {
          const result = await savePromptMutation({ prompt: input.prompt, expectedRevision: input.expectedRevision })
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
    async (input: { readonly id: string; readonly expectedRevision: string }): Promise<PromptLibraryMutation> => {
      if (query.data !== undefined) {
        try {
          const result = await removePromptMutation(input)
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
  const readLatest = useCallback(async (): Promise<PromptLibraryRead> => {
    if (query.data !== undefined) {
      const result = await refetchLibrary()
      return result.isError || result.data === undefined ? { kind: 'unavailable' } : { kind: 'ready', prompts: result.data.prompts }
    }
    if (localStatus.read === 'invalid') return { kind: 'invalid' }
    if (localStatus.read === 'unavailable' || !localStatus.writable) return { kind: 'unavailable' }
    return { kind: 'ready', prompts: localStore.prompts }
  }, [localStatus, localStore, query.data, refetchLibrary])
  const refresh = useCallback(() => void refetchLibrary(), [refetchLibrary])

  const state: PromptLibraryState =
    query.data !== undefined
      ? 'ready'
      : query.isPending
        ? 'loading'
        : localStatus.read === 'invalid'
          ? 'invalid'
          : localStatus.read === 'unavailable' || !localStatus.writable
            ? 'unavailable'
            : 'ready'

  return {
    state,
    prompts: query.data?.prompts ?? localStore.prompts,
    save,
    remove,
    readLatest,
    refresh,
    createId: createPromptId,
    now: nowMilliseconds,
  }
}
