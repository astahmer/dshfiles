import type { DockviewApi } from 'dockview-react'
import type { SidebarResourcePanels } from '@dshfiles/sidebar-right/resource-panels'
import { WORKBENCH_COMPONENT } from './layout-store.js'
import { NewViewTabs, type NewViewSelection } from './new-view.js'
import type { WorkbenchPanelRegistry } from './registry.js'

/**
 * Explicit launch intents for native SidebarRight page types (Terminal, thread facets). Native SidebarRight owns the
 * records, their Session scope and every resource; this adapter owns only a short-lived exact-ID-to-destination
 * handoff, so the page lands in the pane whose chooser asked for it instead of the default right placement.
 */
export const createNativePageAdmission = (resources: Pick<SidebarResourcePanels, 'openPage' | 'close'>, registry: WorkbenchPanelRegistry) => {
  const pending = new Map<string, { readonly api: DockviewApi; readonly selection: NewViewSelection }>()
  const cancelled = new Set<string>()
  return {
    /** Ask the native owner for a page of `kind` in the on-screen thread; false when no thread can take it. */
    launch: (kind: string, api: DockviewApi, selection: NewViewSelection = {}): boolean => {
      let admittedId: string | undefined
      try {
        return (
          resources.openPage?.(kind, id => {
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
    /** Cancel only new, unadmitted launches; existing seated pages are never closed by reset. */
    clear: (): void => {
      for (const id of pending.keys()) cancelled.add(id)
      pending.clear()
    },
  }
}

export type NativePageAdmission = ReturnType<typeof createNativePageAdmission>
