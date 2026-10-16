import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { promptStashApi } from './library-api.js'
import {
  PROMPT_LIBRARY_STORAGE_KEY,
  readPromptLibrary,
  removePromptIfCurrent,
  serializePromptLibrary,
  writePromptIfCurrent,
  type SavedPrompt,
} from './library.js'

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
}

const readLocalLibrary = (): PromptLibraryRead => {
  try {
    const result = readPromptLibrary(window.localStorage.getItem(PROMPT_LIBRARY_STORAGE_KEY))
    return result.ok ? { kind: 'ready', prompts: result.prompts } : { kind: 'invalid' }
  } catch {
    return { kind: 'unavailable' }
  }
}

type LocalWrite = 'ok' | 'too-large' | 'unavailable'

const writeLocalLibrary = (prompts: readonly SavedPrompt[]): LocalWrite => {
  const serialized = serializePromptLibrary(prompts)
  if (serialized === null) return 'too-large'
  try {
    window.localStorage.setItem(PROMPT_LIBRARY_STORAGE_KEY, serialized)
    return 'ok'
  } catch {
    return 'unavailable'
  }
}

const clearLocalLibrary = (): void => {
  try {
    window.localStorage.removeItem(PROMPT_LIBRARY_STORAGE_KEY)
  } catch {
    return
  }
}

/**
 * The shared prompt library. The Host owns it; browser storage stays the
 * fallback only while the API is unavailable (an older Host or the HMR window
 * before a restart), and its content moves to the Host once on first load.
 */
export const usePromptLibrary = (): PromptLibraryClient => {
  const api = useApi(promptStashApi)
  const query = useApiQuery(promptStashApi, 'state')
  const [state, setState] = useState<PromptLibraryState>('loading')
  const [prompts, setPrompts] = useState<readonly SavedPrompt[]>([])
  const host = useRef(false)
  const revision = useRef(0)
  const migrated = useRef(false)
  const refetch = query.refetch

  const adopt = useCallback((snapshot: { readonly revision: number; readonly prompts: readonly SavedPrompt[] }) => {
    if (snapshot.revision < revision.current) return
    revision.current = snapshot.revision
    setPrompts(snapshot.prompts)
  }, [])

  useEffect(() => {
    if (query.data !== undefined) {
      host.current = true
      adopt(query.data)
      setState('ready')
      if (migrated.current) return
      migrated.current = true
      void (async () => {
        const local = readLocalLibrary()
        let migratedAll = local.kind === 'ready'
        if (local.kind === 'ready') {
          for (const prompt of local.prompts) {
            const result = await api.save({ prompt, expectedRevision: null })
            if (result.kind === 'limit') migratedAll = false
          }
        }
        if (migratedAll) clearLocalLibrary()
        refetch()
      })().catch(() => {
        migrated.current = false
      })
      return
    }
    if (query.error !== null) {
      host.current = false
      revision.current = 0
      const local = readLocalLibrary()
      setPrompts(local.kind === 'ready' ? local.prompts : [])
      setState(local.kind)
    }
  }, [adopt, api, query.data, query.error, refetch])

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (host.current || event.key !== PROMPT_LIBRARY_STORAGE_KEY) return
      const update = readPromptLibrary(event.newValue)
      if (!update.ok) {
        setState('invalid')
        return
      }
      setPrompts(update.prompts)
      setState('ready')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const save = useCallback(
    async (input: { readonly prompt: SavedPrompt; readonly expectedRevision: string | null }): Promise<PromptLibraryMutation> => {
      if (host.current) {
        try {
          const result = await api.save(input)
          adopt(result)
          setState('ready')
          return { kind: result.kind, prompts: result.prompts }
        } catch {
          setState('unavailable')
          return { kind: 'unavailable', prompts }
        }
      }
      const local = readLocalLibrary()
      if (local.kind !== 'ready') {
        setState(local.kind)
        return { kind: 'unavailable', prompts: [] }
      }
      const result = writePromptIfCurrent(local.prompts, input.prompt, input.expectedRevision)
      if (result.kind === 'conflict') {
        setPrompts(result.prompts)
        return { kind: 'conflict', prompts: result.prompts }
      }
      const write = writeLocalLibrary(result.prompts)
      if (write === 'too-large') return { kind: 'limit', prompts: local.prompts }
      if (write === 'unavailable') {
        setState('unavailable')
        return { kind: 'unavailable', prompts: local.prompts }
      }
      setPrompts(result.prompts)
      setState('ready')
      return { kind: 'applied', prompts: result.prompts }
    },
    [adopt, api, prompts],
  )

  const remove = useCallback(
    async (input: { readonly id: string; readonly expectedRevision: string }): Promise<PromptLibraryMutation> => {
      if (host.current) {
        try {
          const result = await api.remove(input)
          adopt(result)
          setState('ready')
          return { kind: result.kind, prompts: result.prompts }
        } catch {
          setState('unavailable')
          return { kind: 'unavailable', prompts }
        }
      }
      const local = readLocalLibrary()
      if (local.kind !== 'ready') {
        setState(local.kind)
        return { kind: 'unavailable', prompts: [] }
      }
      const result = removePromptIfCurrent(local.prompts, input.id, input.expectedRevision)
      if (result.kind === 'conflict') {
        setPrompts(result.prompts)
        return { kind: 'conflict', prompts: result.prompts }
      }
      if (writeLocalLibrary(result.prompts) !== 'ok') {
        setState('unavailable')
        return { kind: 'unavailable', prompts: local.prompts }
      }
      setPrompts(result.prompts)
      setState('ready')
      return { kind: 'applied', prompts: result.prompts }
    },
    [adopt, api, prompts],
  )

  const readLatest = useCallback(async (): Promise<PromptLibraryRead> => {
    if (!host.current) return readLocalLibrary()
    try {
      const snapshot = await api.state()
      adopt(snapshot)
      setState('ready')
      return { kind: 'ready', prompts: snapshot.prompts }
    } catch {
      setState('unavailable')
      return { kind: 'unavailable' }
    }
  }, [adopt, api])

  return { state, prompts, save, remove, readLatest, refresh: refetch }
}
