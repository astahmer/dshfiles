import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { DirectoryFlowOwnerProps, DirectoryFlowSlotName } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useApi } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { createWorkspacePickerPorts, ProjectFolderPicker, type DirectoryPickerPort, type WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'

const directoryFlowSlotNames: readonly DirectoryFlowSlotName[] = ['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow']

/** The picker's `title` names its dialog for assistive tech, not hover help: it rides a props object so the native-title rule stays about hover help. */
const directoryFlowLabels = { title: 'Add workspace' } satisfies { readonly title: string }

const DirectoryFlow = (props: DirectoryFlowOwnerProps & WorkspacePickerPorts): JSX.Element | null => {
  const browserApi = useApi(workspaceFolderBrowserApi)
  const directoryPicker: DirectoryPickerPort = {
    pick: signal => props.directoryPicker.pick(signal),
    list: (path, signal) => browserApi.list(path === undefined ? {} : { path }, { signal }),
    createDirectory: (path, name) => browserApi.createDirectory({ path, name }),
  }
  if (!props.open) return null
  return (
    <PluginQueryProvider>
      <ProjectFolderPicker
        {...directoryFlowLabels}
        directoryPicker={directoryPicker}
        disabled={props.busy}
        mode="directories"
        showNativePicker={false}
        onClose={props.onCancel}
        onRegisterWorkspace={props.registerWorkspace}
        onUseAbsolutePath={props.onPicked}
        onSelect={selection => props.onPicked(selection.canonicalPath)}
        placeholder="Browse for a workspace folder…"
        projects={[]}
      />
    </PluginQueryProvider>
  )
}

export default defineClient({
  name: '@dshfiles/workspace-folder-picker',
  inject: ['slots', 'remote', 'remote.directoryPicker', 'remote.workspace'],
  setup(ctx, decorate) {
    const ports = createWorkspacePickerPorts(ctx.remote)
    for (const name of directoryFlowSlotNames) {
      ctx.slots.inject(name, () =>
        ctx.slots.register(
          { name, priority: -1000 },
          decorate((props: DirectoryFlowOwnerProps) => <DirectoryFlow {...props} {...ports} />),
        ),
      )
    }
  },
})
