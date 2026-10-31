import type { ReactNode } from 'react'
import type { ShortcutCatalogEntry } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { HostSnapshotsModel } from '@dshfiles/thread-sidebar/snapshots'
import { DEFAULT_CLOSE_BUTTON_POSITION, type WorkbenchTabsActions, type WorkbenchTabsProvider, type WorkbenchTabsSnapshot } from './workbench-tabs.js'

/** The producer's content snapshot is compared only by identity, never serialized or inspected here. */
type StartContentVersion =
  | symbol
  | {
      readonly byId: ReturnType<typeof HostSnapshotsModel.selectStableSessionListState>['byId']
      readonly statuses: ReturnType<typeof HostSnapshotsModel.selectStableSessionStatus>
      readonly catalog: readonly ShortcutCatalogEntry[]
      readonly panelVersion: string
    }

/** A cache of the existing computed view, not another tab state owner. */
export const createWorkbenchTabsPublication = (
  actions: WorkbenchTabsActions,
  presentation: Pick<WorkbenchTabsProvider, 'renderTabMenu' | 'label'> = {},
  currentSessionId?: () => string | undefined,
) => {
  let snapshot: WorkbenchTabsSnapshot = {
    enabled: false,
    closeButtonPosition: DEFAULT_CLOSE_BUTTON_POSITION,
    scopeKey: 'project:none',
    activeTabId: null,
    tabs: [],
  }
  let fingerprint = JSON.stringify(snapshot)
  let start: () => ReactNode = () => null
  // Opaque referential identity: legacy Symbols and memoized content snapshots both invalidate Start.
  let startVersion: StartContentVersion | undefined
  const listeners = new Set<() => void>()
  const provider: WorkbenchTabsProvider = {
    actions,
    ...presentation,
    getSnapshot: () => snapshot,
    renderStart: () => start(),
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    provider,
    update: (next: WorkbenchTabsSnapshot, renderStart: () => ReactNode, contentVersion?: StartContentVersion): void => {
      start = renderStart
      const startChanged = next.activeTabId === 'start' && startVersion !== contentVersion
      startVersion = contentVersion
      // Parent layout renders may also render shell.overlay. Equal data must not
      // notify Dockview and start a snapshot -> adoption -> render feedback loop.
      const published = currentSessionId === undefined ? next : { ...next, currentSessionId: currentSessionId() }
      const nextFingerprint = JSON.stringify(published)
      if (nextFingerprint === fingerprint && !startChanged) return
      fingerprint = nextFingerprint
      snapshot = startChanged && published === snapshot ? { ...published } : published
      for (const listener of listeners) listener()
    },
  }
}
