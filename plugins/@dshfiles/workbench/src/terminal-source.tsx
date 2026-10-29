import type { DockviewApi } from 'dockview-react'
import type { SidebarResourcePanels } from '@dshfiles/sidebar-right/resource-panels'
import { WORKBENCH_COMPONENT } from './layout-store.js'
import { NewViewTabs, type NewViewSelection } from './new-view.js'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from './registry.js'

const TERMINAL_SOURCE_ID = 'dshfiles-workbench.terminal'

/**
 * Explicit launch intents only. Native SidebarRight owns records, Session scope,
 * xterm, PTY allocation, retained bindings, window holds and close cleanup.
 * This adapter owns only a short-lived exact-ID-to-destination handoff.
 */
export const createWorkbenchTerminalSource = (resources: Pick<SidebarResourcePanels, 'openPage' | 'close'>, registry: WorkbenchPanelRegistry) => {
  const pending = new Map<string, { readonly api: DockviewApi; readonly selection: NewViewSelection }>()
  const cancelled = new Set<string>()
  const definition: WorkbenchPanelDefinition = {
    id: TERMINAL_SOURCE_ID,
    title: 'Terminal: Terminal',
    // This is a launcher, not a repeatable mounted component. Each successful
    // selection creates an independent *native* resource occurrence instead.
    component: () => (
      <p className="dshx-root" role="status">
        Choose a conversation with a workspace, then open Terminal again. The native terminal provider must be enabled.
      </p>
    ),
  }

  return {
    definition,
    /** Called by the composition root only for explicit picker/open intent. */
    open: (source: WorkbenchPanelDefinition, api: DockviewApi, selection: NewViewSelection = {}): boolean => {
      if (source.id !== TERMINAL_SOURCE_ID) return false
      let admittedId: string | undefined
      try {
        return (
          resources.openPage?.('terminal', id => {
            admittedId = id
            pending.set(id, { api, selection })
          }) ?? false
        )
      } catch (error) {
        if (admittedId !== undefined) {
          pending.delete(admittedId)
          cancelled.delete(admittedId)
        }
        throw error
      }
    },
    /** Run after the native resource definition is registered, before default placement. */
    admit: (id: string): boolean => {
      const destination = pending.get(id)
      if (destination === undefined && !cancelled.has(id)) return false
      const resource = registry.get(id)
      if (resource === undefined) return false
      pending.delete(id)
      cancelled.delete(id)
      if (
        destination === undefined ||
        (destination.selection.replacePanelId !== undefined && destination.api.getPanel(destination.selection.replacePanelId) === undefined) ||
        (destination.selection.group !== undefined && !destination.api.groups.includes(destination.selection.group))
      ) {
        // Only this not-yet-seated new occurrence is cancelled. The native
        // close path removes its record/cleans any allocation; claim the ID so
        // the caller cannot silently redirect the cancelled launch elsewhere.
        resources.close(id)
        return true
      }
      const { api, selection } = destination
      if (api.getPanel(id) === undefined) {
        const options = { id, component: WORKBENCH_COMPONENT, title: resource.title }
        if (selection.group !== undefined && api.groups.includes(selection.group)) {
          api.addPanel({ ...options, position: { referenceGroup: selection.group, direction: 'within' } })
        } else api.addPanel(options)
      }
      // A semantic Start chooser also belongs to the tab actor. Admit its
      // explicit close before removing presentation, just like generic picks.
      if (selection.replacePanelId !== undefined) registry.get(selection.replacePanelId)?.beforeClose?.()
      NewViewTabs.completeSelection(api, id, selection)
      return true
    },
    /** Cancel only new, unadmitted launches; existing seated terminals are never closed by reset. */
    clear: (): void => {
      for (const id of pending.keys()) cancelled.add(id)
      pending.clear()
    },
  }
}
