import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { type SidebarPreferences } from './organization.js'
import type { PaletteMode } from './palette.js'
import { loadPreferences, parseStoredPreferences, PREFERENCES_STORAGE_KEY, savePreferences } from './preferences.js'

export interface PaletteDestination {
  readonly id: string
  readonly label: string
  readonly icon: ReactNode
  readonly run: () => void
}

interface PreferencesSnapshot {
  readonly preferences: SidebarPreferences
  readonly storageWarning: boolean
}

const listeners = new Set<() => void>()
let snapshot: PreferencesSnapshot | null = null

const readSnapshot = (): PreferencesSnapshot => {
  snapshot ??= { preferences: loadPreferences(), storageWarning: false }
  return snapshot
}

const publish = (next: PreferencesSnapshot): void => {
  snapshot = next
  listeners.forEach(listener => listener())
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  const syncFromStorage = (event: StorageEvent): void => {
    if (event.key !== PREFERENCES_STORAGE_KEY) return
    publish({ preferences: parseStoredPreferences(event.newValue), storageWarning: false })
  }
  if (listeners.size === 1) window.addEventListener('storage', syncFromStorage)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('storage', syncFromStorage)
  }
}

export const updateStoredPreferences = (patch: Partial<SidebarPreferences>): void => {
  const preferences = { ...readSnapshot().preferences, ...patch }
  publish({ preferences, storageWarning: !savePreferences(preferences) })
}

/** Preferences shared by every surface of this bundle in the current document (sidebar and its Settings tab). */
export const usePreferences = (): PreferencesSnapshot & { updatePreferences: (patch: Partial<SidebarPreferences>) => void } => {
  const current = useSyncExternalStore(subscribe, readSnapshot)
  return { ...current, updatePreferences: updateStoredPreferences }
}

interface SidebarState {
  preferences: SidebarPreferences
  updatePreferences: (patch: Partial<SidebarPreferences>) => void
  storageWarning: boolean
  threadQuery: string
  setThreadQuery: (query: string) => void
  paletteMode: PaletteMode | null
  openPalette: (mode: PaletteMode) => void
  closePalette: () => void
  destinations: readonly PaletteDestination[]
  setDestinations: (destinations: readonly PaletteDestination[]) => void
}

const SidebarStateContext = createContext<SidebarState | null>(null)

export const useSidebarState = (): SidebarState => {
  const state = useContext(SidebarStateContext)
  if (state === null) throw new Error('Sidebar state is unavailable outside its root')
  return state
}

export const SidebarStateProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const { preferences, storageWarning, updatePreferences } = usePreferences()
  const [threadQuery, setThreadQuery] = useState('')
  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null)
  const [destinations, setDestinations] = useState<readonly PaletteDestination[]>([])
  const openPalette = useCallback((mode: PaletteMode) => setPaletteMode(mode), [])
  const closePalette = useCallback(() => setPaletteMode(null), [])

  const state = useMemo(
    () => ({
      preferences,
      updatePreferences,
      storageWarning,
      threadQuery,
      setThreadQuery,
      paletteMode,
      openPalette,
      closePalette,
      destinations,
      setDestinations,
    }),
    [preferences, updatePreferences, storageWarning, threadQuery, paletteMode, openPalette, closePalette, destinations],
  )

  return <SidebarStateContext.Provider value={state}>{children}</SidebarStateContext.Provider>
}
