import type { MainNavigationResult, WorkbenchPanelDefinition } from './registry.js'
import type { WorkbenchTabsProvider } from './tabs.js'

/** Resolve the actor-owned semantic occurrence, including one that is still being registered. */
export const createMainNavigation = (ports: {
  readonly isWorkbench: () => boolean
  readonly definition: (mainPanelId: string) => WorkbenchPanelDefinition | undefined
  readonly definitionForTab: (tabId: string) => WorkbenchPanelDefinition | undefined
  readonly tabs: () => WorkbenchTabsProvider
  readonly subscribeRegistry: (listener: () => void) => () => void
  readonly requestSemantic: (panelId: string, title: string) => void
  readonly reveal: (panelId: string) => void
}) => {
  const pending = new Set<() => void>()
  return {
    dispose: () => {
      for (const cancel of [...pending]) cancel()
    },
    open: async (mainPanelId: string): Promise<MainNavigationResult> => {
      if (!ports.isWorkbench()) return { kind: 'native' }
      const definition = ports.definition(mainPanelId)
      if (definition === undefined) throw new Error(`Workbench panel not registered: ${mainPanelId}`)
      const tabs = ports.tabs()
      if (!tabs.getSnapshot().enabled) {
        ports.reveal(definition.id)
        return { kind: 'workbench', panelId: definition.id }
      }
      const scopeKey = tabs.getSnapshot().scopeKey
      const find = () => {
        const snapshot = tabs.getSnapshot()
        const candidates = snapshot.tabs.filter(tab => tab.target.kind === 'panel' && tab.target.panelId === mainPanelId && tab.target.scope === undefined)
        return candidates.find(tab => tab.id === snapshot.activeTabId) ?? candidates[0]
      }
      const initial = find()
      if (initial === undefined) ports.requestSemantic(mainPanelId, definition.title)
      else tabs.actions.activate(initial.id)
      const resolvePanel = (): string | undefined => {
        const tab = find()
        return tab === undefined ? undefined : ports.definitionForTab(tab.id)?.id
      }
      let id = resolvePanel()
      if (id === undefined)
        id = await new Promise<string>((resolve, reject) => {
          let offTabs = () => {}
          let offRegistry = () => {}
          const finish = () => {
            clearTimeout(timeout)
            offTabs()
            offRegistry()
            pending.delete(cancel)
          }
          const cancel = () => {
            finish()
            reject(new Error(`Workbench panel navigation cancelled: ${mainPanelId}`))
          }
          const timeout = setTimeout(cancel, 10_000)
          pending.add(cancel)
          const check = () => {
            if (tabs.getSnapshot().scopeKey !== scopeKey || !ports.isWorkbench()) {
              cancel()
              return
            }
            const found = resolvePanel()
            if (found === undefined) return
            finish()
            resolve(found)
          }
          offTabs = tabs.subscribe(check)
          offRegistry = ports.subscribeRegistry(check)
          check()
        })
      if (tabs.getSnapshot().scopeKey !== scopeKey || !ports.isWorkbench()) throw new Error(`Workbench panel navigation cancelled: ${mainPanelId}`)
      ports.reveal(id)
      return { kind: 'workbench', panelId: id }
    },
  }
}
