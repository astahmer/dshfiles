import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { type SidebarPreferences } from './organization.js'
import { loadPreferences, parseStoredPreferences, PREFERENCES_STORAGE_KEY, savePreferences } from './preferences.js'

interface SidebarState {
  preferences: SidebarPreferences
  updatePreferences: (patch: Partial<SidebarPreferences>) => void
  storageWarning: boolean
  threadQuery: string
  setThreadQuery: (query: string) => void
}

const SidebarStateContext = createContext<SidebarState | null>(null)

export const useSidebarState = (): SidebarState => {
  const state = useContext(SidebarStateContext)
  if (state === null) throw new Error('Sidebar state is unavailable outside its root')
  return state
}

export const SidebarStateProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [preferences, setPreferences] = useState(loadPreferences)
  const [preferencesDirty, setPreferencesDirty] = useState(false)
  const [storageWarning, setStorageWarning] = useState(false)
  const [threadQuery, setThreadQuery] = useState('')

  const updatePreferences = useCallback((patch: Partial<SidebarPreferences>) => {
    setPreferences(current => ({ ...current, ...patch }))
    setPreferencesDirty(true)
  }, [])

  useEffect(() => {
    if (!preferencesDirty) return
    setStorageWarning(!savePreferences(preferences))
    setPreferencesDirty(false)
  }, [preferences, preferencesDirty])

  useEffect(() => {
    const syncFromStorage = (event: StorageEvent): void => {
      if (event.key !== PREFERENCES_STORAGE_KEY) return
      setPreferences(parseStoredPreferences(event.newValue))
      setPreferencesDirty(false)
      setStorageWarning(false)
    }
    window.addEventListener('storage', syncFromStorage)
    return () => window.removeEventListener('storage', syncFromStorage)
  }, [])

  const state = useMemo(
    () => ({ preferences, updatePreferences, storageWarning, threadQuery, setThreadQuery }),
    [preferences, updatePreferences, storageWarning, threadQuery],
  )

  return <SidebarStateContext.Provider value={state}>{children}</SidebarStateContext.Provider>
}
