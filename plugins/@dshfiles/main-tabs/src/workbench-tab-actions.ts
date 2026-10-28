import type { TabSet, TabsEvent } from './tabs-machine.js'
import type { WorkbenchTabsActions } from './workbench-tabs.js'

interface WorkbenchTabsActionPorts {
  readonly enabled: () => boolean
  readonly currentSet: () => TabSet | undefined
  /** The same event adapter used by the native strip (including sidebar focus). */
  readonly send: (event: TabsEvent) => void
  /** Explicit user re-selection may acknowledge unread state without navigating again. */
  readonly reselect: (tabId: string) => void
  /** Undefined keeps native behavior; Workbench acceptance moves presentation without closing actor state. */
  readonly dockAside?: (tabId: string) => boolean | undefined
  readonly threadAside: (sessionId: string) => boolean
  readonly panelAside: (panelId: string) => boolean
  readonly renameThread: WorkbenchTabsActions['renameThread']
}

/** Adapter only: all tab transitions still run on the one existing actor. */
export const createWorkbenchTabsActions = (ports: WorkbenchTabsActionPorts): WorkbenchTabsActions => {
  const existing = (id: string) => (ports.enabled() ? ports.currentSet()?.tabs.find(tab => tab.id === id) : undefined)
  const sendExisting = (event: TabsEvent & { readonly tabId: string }): void => {
    if (existing(event.tabId) !== undefined) ports.send(event)
  }
  return {
    activate: tabId => {
      if (existing(tabId) === undefined) return
      // User re-clicks acknowledge attention, but never start another navigate/report cycle.
      if (ports.currentSet()?.activeTabId === tabId) ports.reselect(tabId)
      else sendExisting({ type: 'tab.select', tabId })
    },
    close: tabId => sendExisting({ type: 'tab.close', tabId }),
    keep: tabId => sendExisting({ type: 'tab.keep', tabId }),
    togglePin: tabId => sendExisting({ type: 'tab.togglePin', tabId }),
    move: (tabId, toIndex) => {
      if (Number.isInteger(toIndex)) sendExisting({ type: 'tab.move', tabId, toIndex })
    },
    closeOthers: tabId => sendExisting({ type: 'tab.closeOthers', tabId }),
    closeToRight: tabId => sendExisting({ type: 'tab.closeToRight', tabId }),
    moveAside: tabId => {
      const tab = existing(tabId)
      if (tab === undefined || tab.target.kind === 'start') return false
      const docked = ports.dockAside?.(tabId)
      if (docked !== undefined) return docked
      const accepted = tab.target.kind === 'thread' ? ports.threadAside(tab.target.sessionId) : ports.panelAside(tab.target.panelId)
      if (!accepted) return false
      ports.send({ type: 'tab.close', tabId })
      return true
    },
    open: (target, newTab = false, title) => {
      if (ports.enabled()) ports.send({ type: 'tab.open', target, newTab, title })
    },
    newTab: () => {
      if (ports.enabled()) ports.send({ type: 'tab.new' })
    },
    renameThread: ports.renameThread,
  }
}
