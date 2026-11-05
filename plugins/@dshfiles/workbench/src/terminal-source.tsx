import type { DockviewApi } from 'dockview-react'
import type { SidebarResourcePanels } from '@dshfiles/sidebar-right/resource-panels'
import type { NewViewSelection } from './new-view.js'
import { createNativePageAdmission } from './native-page-admission.js'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from './registry.js'

const TERMINAL_SOURCE_ID = 'dshfiles-workbench.terminal'

/**
 * Explicit launch intents only. Native SidebarRight owns records, Session scope,
 * xterm, PTY allocation, retained bindings, window holds and close cleanup.
 * This adapter owns only a short-lived exact-ID-to-destination handoff.
 */
export const createWorkbenchTerminalSource = (resources: Pick<SidebarResourcePanels, 'openPage' | 'close'>, registry: WorkbenchPanelRegistry) => {
  const admission = createNativePageAdmission(resources, registry)
  const definition: WorkbenchPanelDefinition = {
    id: TERMINAL_SOURCE_ID,
    title: 'Terminal: Terminal',
    allowMultiple: false,
    // This is a launcher, not a repeatable mounted component. Each successful
    // selection creates an independent *native* resource occurrence instead.
    component: () => (
      <p className="dshx-root" role="status">
        Choose a thread with a workspace, then open Terminal again. The native terminal provider must be enabled.
      </p>
    ),
  }

  return {
    definition,
    /** Called by the composition root only for explicit picker/open intent. */
    open: (source: WorkbenchPanelDefinition, api: DockviewApi, selection: NewViewSelection = {}): boolean =>
      source.id === TERMINAL_SOURCE_ID && admission.launch('terminal', api, selection),
    /** Run after the native resource definition is registered, before default placement. */
    admit: admission.admit,
    /** Cancel only new, unadmitted launches; existing seated terminals are never closed by reset. */
    clear: admission.clear,
  }
}
