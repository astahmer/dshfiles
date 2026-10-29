import type { HostTarget, WorkbenchTab, WorkbenchTabsProvider } from '@dshfiles/workbench/tabs'
import type { MainTabsService } from './tabs-contract.js'
import { tabIdOf, type TabSet } from './tabs-machine.js'

const NO_TABS: readonly WorkbenchTab[] = []

/** Adapter only: reads the published strip view and drives the same actions the Workbench uses. */
export const createMainTabsService = (ports: {
  readonly provider: WorkbenchTabsProvider
  readonly enabled: () => boolean
  readonly currentSet: () => TabSet | undefined
  readonly isListedThread: (sessionId: string) => boolean
}): MainTabsService => {
  const tabs = (): readonly WorkbenchTab[] => {
    const snapshot = ports.provider.getSnapshot()
    return snapshot.enabled ? snapshot.tabs : NO_TABS
  }
  const has = (tabId: string): boolean => ports.enabled() && ports.currentSet()?.tabs.some(tab => tab.id === tabId) === true
  return {
    tabs: { get: tabs, subscribe: ports.provider.subscribe },
    open: (target: HostTarget, options = {}) => {
      if (!ports.enabled() || (target.kind === 'thread' && !ports.isListedThread(target.sessionId))) return undefined
      ports.provider.actions.open(target, options.newTab ?? false, options.title)
      return tabIdOf(target)
    },
    focus: tabId => {
      if (!has(tabId)) return false
      ports.provider.actions.activate(tabId)
      return true
    },
    close: tabId => {
      if (!has(tabId)) return false
      ports.provider.actions.close(tabId)
      return true
    },
  }
}
