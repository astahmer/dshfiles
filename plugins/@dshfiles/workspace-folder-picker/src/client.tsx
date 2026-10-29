import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { DirectoryFlowOwnerProps, DirectoryFlowSlotName } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { ChevronDownIcon, GitBranchIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { createWorkspacePickerPorts, ProjectFolderPicker, type DirectoryPickerPort, type WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { useState } from 'react'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'
import { ProjectCloneDialog } from './project-clone-dialog.js'
import { projectLifecycleApi } from './project-lifecycle-api.js'

const directoryFlowSlotNames: readonly DirectoryFlowSlotName[] = ['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow']

const directoryFlowLabels = { heading: 'Add workspace' } satisfies { readonly heading: string }

type DirectoryFlowView = 'browse' | 'clone'

const DirectoryFlowContent = (props: DirectoryFlowOwnerProps & WorkspacePickerPorts): JSX.Element => {
  const browserApi = useApi(workspaceFolderBrowserApi)
  const lifecycleApi = useApi(projectLifecycleApi)
  const [view, setView] = useState<DirectoryFlowView>('browse')
  const tools = useQuery({ queryKey: ['workspace-folder-picker', 'project-tools'], queryFn: () => lifecycleApi.tools({}), retry: false, staleTime: 60_000 })
  const directoryPicker: DirectoryPickerPort = {
    pick: signal => props.directoryPicker.pick(signal),
    list: (path, signal) => browserApi.list(path === undefined ? {} : { path }, { signal }),
    createDirectory: (path, name) => browserApi.createDirectory({ path, name }),
  }
  if (view === 'clone') {
    return <ProjectCloneDialog api={lifecycleApi} home={tools.data?.home} onClose={() => setView('browse')} onCloned={path => props.onPicked(path)} />
  }
  const addActions = tools.isSuccess ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="dshx:shrink-0" disabled={props.busy} type="button" variant="outline">
          New
          <ChevronDownIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root">
        <DropdownMenuItem disabled={!tools.data.git} onSelect={() => setView('clone')}>
          <GitBranchIcon aria-hidden />
          Clone repository…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null
  return (
    <ProjectFolderPicker
      {...directoryFlowLabels}
      directoryPicker={directoryPicker}
      disabled={props.busy}
      headerActions={addActions}
      mode="directories"
      showNativePicker={false}
      onClose={props.onCancel}
      onRegisterWorkspace={props.registerWorkspace}
      onUseAbsolutePath={props.onPicked}
      onSelect={selection => props.onPicked(selection.canonicalPath)}
      placeholder="Browse for a workspace folder…"
      projects={[]}
    />
  )
}

const DirectoryFlow = (props: DirectoryFlowOwnerProps & WorkspacePickerPorts): JSX.Element | null => {
  if (!props.open) return null
  return (
    <PluginQueryProvider>
      <DirectoryFlowContent {...props} />
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
