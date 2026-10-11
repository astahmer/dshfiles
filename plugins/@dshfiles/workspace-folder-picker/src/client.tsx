import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { createWorkspacePickerPorts, ProjectFolderPicker } from '@dshfiles/project-folder-picker'
import './client.css'

export default defineClient({
  name: '@dshfiles/workspace-folder-picker',
  inject: ['slots', 'remote'],
  setup(ctx, decorate) {
    const ports = createWorkspacePickerPorts(ctx.remote)
    ctx.slots.inject('sidebar.workspaces.directoryFlow', () =>
      ctx.slots.register(
        { name: 'sidebar.workspaces.directoryFlow', priority: -1000 },
        decorate(props =>
          props.open ? (
            <PluginQueryProvider>
              <ProjectFolderPicker
                directoryPicker={ports.directoryPicker}
                disabled={props.busy}
                mode="directories"
                onClose={props.onCancel}
                onRegisterWorkspace={ports.registerWorkspace}
                onSelect={selection => props.onPicked(selection.canonicalPath)}
                placeholder="Browse for a workspace folder…"
                projects={[]}
                title="Add workspace"
              />
            </PluginQueryProvider>
          ) : null,
        ),
      ),
    )
  },
})
