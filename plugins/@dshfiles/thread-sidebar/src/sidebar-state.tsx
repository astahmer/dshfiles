import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { useSettings } from '@dshfiles/dshx/client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { DEFAULT_PREFERENCES, type SidebarPreferences } from './organization.js'
import type { PaletteMode } from './palette.js'
import { decodePreferences, isPreferenceKey, preferencesToMigrate, storedPreferences } from './preferences.js'
import { threadSidebarSettings } from './settings.js'

export interface PaletteDestination {
  readonly id: string
  /** Host shortcut commands are listed apart from the sidebar's own destinations and actions. */
  readonly group: 'destination' | 'command'
  readonly label: string
  readonly aliases?: readonly string[]
  /** Keycaps of the bound shortcut, shown as a hint. */
  readonly keys?: readonly string[]
  readonly icon: ReactNode
  readonly run: () => void
}

interface PreferencesSnapshot {
  readonly preferences: SidebarPreferences
  readonly storageWarning: boolean
}

/**
 * A component outside a DSHX-decorated slot, or a Host started before this
 * namespace existed, must still render, so a missing Settings context means
 * "use the fallback". `useSettings` throws on its first hook when the context is
 * absent, which keeps the hook order stable across renders.
 */
type ThreadSidebarSettingsState = ReturnType<typeof useThreadSidebarSettings>
const useThreadSidebarSettings = () => useSettings(threadSidebarSettings)

const useOptionalSettings = (): ThreadSidebarSettingsState | null => {
  try {
    return useThreadSidebarSettings()
  } catch {
    return null
  }
}

/**
 * Preferences from DSH Settings (Host-synced). Browser storage only stands in
 * while the Host namespace is unavailable. Writes are not optimistic in the
 * Settings API, so a pending overlay keeps drags and toggles from snapping back.
 */
export const usePreferences = (): PreferencesSnapshot & {
  hostBacked: boolean
  updatePreferences: (patch: Partial<SidebarPreferences>) => void
} => {
  const settings = useOptionalSettings()
  const localPreferences = storedPreferences.useValue() ?? DEFAULT_PREFERENCES
  const [localWriteFailed, setLocalWriteFailed] = useState(false)
  const [pending, setPending] = useState<Partial<SidebarPreferences>>({})
  const [writeFailed, setWriteFailed] = useState(false)
  const hostPreferences = useMemo(() => (settings?.value === undefined ? null : decodePreferences(settings.value)), [settings?.value])
  const hostBacked = settings !== null && settings.status === 'ready' && settings.writable && hostPreferences !== null
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const updatePreferences = useCallback(
    (patch: Partial<SidebarPreferences>) => {
      if (!hostBacked) {
        setLocalWriteFailed(!storedPreferences.set({ ...(storedPreferences.get() ?? DEFAULT_PREFERENCES), ...patch }))
        return
      }
      setPending(current => ({ ...current, ...patch }))
      const writeKey = <Key extends keyof SidebarPreferences>(key: Key): Promise<boolean> => {
        const value = patch[key]
        const current = settingsRef.current
        return value === undefined || current === null ? Promise.resolve(true) : current.set(key, value)
      }
      const keys = Object.keys(patch).filter(isPreferenceKey)
      void Promise.all(keys.map(writeKey))
        .then(results => setWriteFailed(results.includes(false)))
        .catch(() => setWriteFailed(true))
        .finally(() =>
          setPending(current => {
            const next = { ...current }
            for (const key of keys) if (Object.is(next[key], patch[key])) delete next[key]
            return next
          }),
        )
    },
    [hostBacked],
  )

  useEffect(() => {
    if (!hostBacked || hostPreferences === null) return
    const stored = storedPreferences.get()
    if (stored === null) return
    storedPreferences.remove()
    const patch = preferencesToMigrate(stored, hostPreferences)
    if (Object.keys(patch).length > 0) updatePreferences(patch)
  }, [hostBacked, hostPreferences, updatePreferences])

  const preferences = useMemo(
    () => (hostBacked ? { ...hostPreferences, ...pending } : localPreferences),
    [hostBacked, hostPreferences, pending, localPreferences],
  )
  return { preferences, storageWarning: hostBacked ? writeFailed : localWriteFailed, hostBacked, updatePreferences }
}

interface SidebarState {
  preferences: SidebarPreferences
  updatePreferences: (patch: Partial<SidebarPreferences>) => void
  storageWarning: boolean
  openPalette: (mode: PaletteMode) => void
  closePalette: () => void
  setDestinations: (destinations: readonly PaletteDestination[]) => void
  /** The thread shown in the main view, reported by the thread list for navigation history. */
  selectedThreadId: SessionSummary['id'] | null
  setSelectedThreadId: (sessionId: SessionSummary['id'] | null) => void
  /** Thread titles for the history menu, kept current by the thread list without re-rendering the shell. */
  threadTitle: MutableRefObject<(sessionId: SessionSummary['id']) => string | undefined>
}

interface PaletteState {
  paletteMode: PaletteMode | null
  destinations: readonly PaletteDestination[]
}

const SidebarStateContext = createContext<SidebarState | null>(null)
const PaletteStateContext = createContext<PaletteState | null>(null)

export const useSidebarState = (): SidebarState => {
  const state = useContext(SidebarStateContext)
  if (state === null) throw new Error('Sidebar state is unavailable outside its root')
  return state
}

/** Separate from {@link useSidebarState} so opening the palette does not re-render every sidebar consumer. */
export const usePaletteState = (): PaletteState => {
  const state = useContext(PaletteStateContext)
  if (state === null) throw new Error('Palette state is unavailable outside its root')
  return state
}

export const SidebarStateProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const { preferences, storageWarning, updatePreferences } = usePreferences()
  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null)
  const [destinations, setDestinations] = useState<readonly PaletteDestination[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<SessionSummary['id'] | null>(null)
  const threadTitle = useRef<(sessionId: SessionSummary['id']) => string | undefined>(() => undefined)
  const openPalette = useCallback((mode: PaletteMode) => setPaletteMode(mode), [])
  const closePalette = useCallback(() => setPaletteMode(null), [])

  const state = useMemo(
    () => ({ preferences, updatePreferences, storageWarning, openPalette, closePalette, setDestinations, selectedThreadId, setSelectedThreadId, threadTitle }),
    [preferences, updatePreferences, storageWarning, openPalette, closePalette, selectedThreadId],
  )
  const paletteState = useMemo(() => ({ paletteMode, destinations }), [paletteMode, destinations])

  return (
    <SidebarStateContext.Provider value={state}>
      <PaletteStateContext.Provider value={paletteState}>{children}</PaletteStateContext.Provider>
    </SidebarStateContext.Provider>
  )
}
