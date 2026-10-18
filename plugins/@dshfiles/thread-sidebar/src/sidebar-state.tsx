import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { useSettings } from '@dshfiles/dshx/client'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { PaletteApi, type PaletteMode } from '@dshfiles/command-palette/api'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { DEFAULT_PREFERENCES, type SidebarPreferences } from './organization.js'
import { SidebarPreferencesModel, storedPreferences } from './preferences.js'
import { SidebarPreferencesMachine, type SidebarPreferencesMachineClient } from './preferences-machine.js'
import { threadSidebarSettings } from './settings.js'

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
  const hostPreferences = useMemo(() => (settings?.value === undefined ? null : SidebarPreferencesModel.decode(settings.value)), [settings?.value])
  const hostBacked = settings !== null && settings.status === 'ready' && settings.writable && hostPreferences !== null
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const client = useMemo<SidebarPreferencesMachineClient>(
    () => ({
      readLocal: () => storedPreferences.get(),
      readHost: () => {
        const current = settingsRef.current
        if (current === null || current.status !== 'ready' || !current.writable || current.value === undefined) return null
        return SidebarPreferencesModel.decode(current.value)
      },
      writeHost: async patch => {
        const current = settingsRef.current
        if (current === null || current.status !== 'ready' || !current.writable || current.value === undefined) return false
        if (SidebarPreferencesModel.decode(current.value) === null) return false
        const writeKey = <Key extends keyof SidebarPreferences>(key: Key): Promise<boolean> => {
          const value = patch[key]
          return value === undefined ? Promise.resolve(true) : current.set(key, value)
        }
        const keys = Object.keys(patch).filter(SidebarPreferencesModel.isPreferenceKey)
        const results = await Promise.all(keys.map(writeKey))
        return !results.includes(false)
      },
      removeLocal: () => storedPreferences.remove(),
    }),
    [settingsRef],
  )
  const [snapshot, send] = useMachine(SidebarPreferencesMachine.machine, { input: { client } })
  const updatePreferences = useCallback(
    (patch: Partial<SidebarPreferences>) => {
      if (!hostBacked) {
        send({
          type: 'local.write.result',
          success: storedPreferences.set({ ...(storedPreferences.get() ?? DEFAULT_PREFERENCES), ...patch }),
        })
        return
      }
      send({ type: 'host.update', patch })
    },
    [hostBacked, send],
  )

  useEffect(() => {
    if (!hostBacked || hostPreferences === null || storedPreferences.get() === null) return
    send({ type: 'migration.requested' })
  }, [hostBacked, hostPreferences, send])

  const preferences = useMemo(
    () => (hostBacked ? { ...hostPreferences, ...snapshot.context.pending } : localPreferences),
    [hostBacked, hostPreferences, snapshot.context.pending, localPreferences],
  )
  return {
    preferences,
    storageWarning: hostBacked ? snapshot.context.hostWriteFailed : snapshot.context.localWriteFailed,
    hostBacked,
    updatePreferences,
  }
}

interface SidebarState {
  preferences: SidebarPreferences
  updatePreferences: (patch: Partial<SidebarPreferences>) => void
  storageWarning: boolean
  /** True while DSH Settings serves the sidebar namespace and accepts writes. */
  hostBacked: boolean
  openPalette: (mode: PaletteMode) => void
  closePalette: () => void
  /** The thread shown in the main view, reported by the thread list for navigation history. */
  selectedThreadId: SessionSummary['id'] | null
  setSelectedThreadId: (sessionId: SessionSummary['id'] | null) => void
  /** Thread titles for the history menu, kept current by the thread list without re-rendering the shell. */
  threadTitle: MutableRefObject<(sessionId: SessionSummary['id']) => string | undefined>
}

const SidebarStateContext = createContext<SidebarState | null>(null)

export const useSidebarState = (): SidebarState => {
  const state = useContext(SidebarStateContext)
  if (state === null) throw new Error('Sidebar state is unavailable outside its root')
  return state
}

export const SidebarStateProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const { preferences, storageWarning, hostBacked, updatePreferences } = usePreferences()
  const [selectedThreadId, setSelectedThreadId] = useState<SessionSummary['id'] | null>(null)
  const threadTitle = useRef<(sessionId: SessionSummary['id']) => string | undefined>(() => undefined)

  const state = useMemo(
    () => ({
      preferences,
      updatePreferences,
      storageWarning,
      hostBacked,
      openPalette: PaletteApi.open,
      closePalette: PaletteApi.close,
      selectedThreadId,
      setSelectedThreadId,
      threadTitle,
    }),
    [preferences, updatePreferences, storageWarning, hostBacked, selectedThreadId],
  )

  return <SidebarStateContext.Provider value={state}>{children}</SidebarStateContext.Provider>
}
