import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { useSettings } from '@dshfiles/dshx/client'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import type { PaletteMode } from '@dshfiles/command-palette/palette-contract'
import { PaletteBridge } from './palette-bridge.js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode } from 'react'
import { storedCollapsedGroups } from './collapsed-groups.js'
import { DEFAULT_PREFERENCES, type SidebarPreferences } from './organization.js'
import { SidebarPreferencesModel, storedPreferences } from './preferences.js'
import { SidebarPreferencesMachine, type SidebarPreferencesMachineClient } from './preferences-machine.js'
import { threadSidebarSettings } from './settings.js'
import { doneViewFilterMigration, shippedViewFiltersMigration, threadViewPreferences } from './thread-view-preferences.js'
import { storedThreadBoardView } from './thread-board-view.js'

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
  boardViewOnHost: boolean
  layoutMergeOnHost: boolean
  settingsSettled: boolean
  threadViewWritePending: boolean
  updatePreferences: (patch: Partial<SidebarPreferences>) => void
} => {
  const settings = useOptionalSettings()
  const localPreferences = storedPreferences.useValue() ?? DEFAULT_PREFERENCES
  const hostPreferences = useMemo(() => (settings?.value === undefined ? null : SidebarPreferencesModel.decode(settings.value)), [settings?.value])
  const hostBacked = settings !== null && settings.status === 'ready' && settings.writable && hostPreferences !== null
  // A Host whose settings schema predates the Board view field returns no `boardView`: the browser copy stays live.
  const boardViewOnHost = hostBacked && typeof settings.value === 'object' && settings.value !== null && 'boardView' in settings.value
  // The one sidebar layout's merge marker (b:952m) is Host state only once the restarted Host declares it.
  const layoutMergeOnHost = hostBacked && typeof settings.value === 'object' && settings.value !== null && 'layoutMerge' in settings.value
  // Whether the Host answered (or will not): a fallback read before that is not yet the person's settings.
  const settingsSettled = settings === null || settings.status !== 'loading'
  const boardViewOnHostRef = useRef(boardViewOnHost)
  boardViewOnHostRef.current = boardViewOnHost
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
        return current.setMany(patch)
      },
      removeLocal: () => storedPreferences.remove(),
      legacy: {
        read: () => ({
          threadViews: {
            settings: threadViewPreferences.get(),
            doneFiltersMigrated: doneViewFilterMigration.get(),
            shippedFiltersMigrated: shippedViewFiltersMigration.get(),
          },
          collapsedGroups: storedCollapsedGroups.get(),
          boardView: boardViewOnHostRef.current ? storedThreadBoardView.get() : null,
        }),
        clear: () => {
          threadViewPreferences.remove()
          doneViewFilterMigration.set(true)
          shippedViewFiltersMigration.set(true)
          storedCollapsedGroups.remove()
          if (boardViewOnHostRef.current) storedThreadBoardView.remove()
        },
      },
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

  const threadViewWritePending = snapshot.context.pendingOperationIds.threadViews !== undefined
  // One-shot: the machine queues it once and latches its outcome, so a later render never replays the hand-over.
  useEffect(() => {
    if (!hostBacked || threadViewWritePending) return
    send({ type: 'migration.requested' })
  }, [hostBacked, threadViewWritePending, send])

  const preferences = useMemo(
    () => (hostBacked ? { ...hostPreferences, ...snapshot.context.pending } : localPreferences),
    [hostBacked, hostPreferences, snapshot.context.pending, localPreferences],
  )
  return {
    preferences,
    storageWarning: hostBacked ? snapshot.context.hostWriteFailed : snapshot.context.localWriteFailed,
    hostBacked,
    boardViewOnHost,
    layoutMergeOnHost,
    settingsSettled,
    threadViewWritePending,
    updatePreferences,
  }
}

interface SidebarState {
  preferences: SidebarPreferences
  updatePreferences: (patch: Partial<SidebarPreferences>) => void
  storageWarning: boolean
  threadViewWritePending: boolean
  /** True while DSH Settings serves the sidebar namespace and accepts writes. */
  hostBacked: boolean
  /** True when that namespace also holds the Board view (E9); an older Host keeps it in this browser. */
  boardViewOnHost: boolean
  /** True when that namespace declares the one sidebar layout's merge marker (b:952m). */
  layoutMergeOnHost: boolean
  /** False while the Host settings are still loading: preferences are then only the browser's fallback. */
  settingsSettled: boolean
  openPalette: (mode: PaletteMode) => void
  closePalette: () => void
  /** The thread shown in the main view, reported by the thread list for navigation history. */
  selectedThreadId: SessionSummary['id'] | null
  setSelectedThreadId: (sessionId: SessionSummary['id'] | null) => void
  /** The thread last picked in the list, before the main view opens it; each pick is a new object. */
  pickedThread: { readonly id: SessionSummary['id'] } | null
  pickThread: (sessionId: SessionSummary['id']) => void
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
  const { preferences, storageWarning, hostBacked, boardViewOnHost, layoutMergeOnHost, settingsSettled, threadViewWritePending, updatePreferences } =
    usePreferences()
  const [selectedThreadId, setSelectedThreadId] = useState<SessionSummary['id'] | null>(null)
  const threadTitle = useRef<(sessionId: SessionSummary['id']) => string | undefined>(() => undefined)
  const [pickedThread, setPickedThread] = useState<{ readonly id: SessionSummary['id'] } | null>(null)
  const pickThread = useCallback((id: SessionSummary['id']) => setPickedThread({ id }), [])

  const state = useMemo(
    () => ({
      preferences,
      updatePreferences,
      storageWarning,
      hostBacked,
      boardViewOnHost,
      layoutMergeOnHost,
      settingsSettled,
      threadViewWritePending,
      openPalette: PaletteBridge.open,
      closePalette: PaletteBridge.close,
      selectedThreadId,
      setSelectedThreadId,
      pickedThread,
      pickThread,
      threadTitle,
    }),
    [
      preferences,
      updatePreferences,
      storageWarning,
      hostBacked,
      boardViewOnHost,
      layoutMergeOnHost,
      settingsSettled,
      threadViewWritePending,
      selectedThreadId,
      pickedThread,
      pickThread,
    ],
  )

  return <SidebarStateContext.Provider value={state}>{children}</SidebarStateContext.Provider>
}
