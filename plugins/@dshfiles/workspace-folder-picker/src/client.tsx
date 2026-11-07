import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { DirectoryFlowOwnerProps, DirectoryFlowSlotName } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useApi } from '@dshfiles/dshx/client'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { ChevronDownIcon, FolderPlusIcon, GitBranchIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { createWorkspacePickerPorts, ProjectFolderPicker, type DirectoryPickerPort, type WorkspacePickerPorts } from './picker/index.js'
import { useState } from 'react'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'
import { ProjectCloneDialog } from './project-clone-dialog.js'
import { ProjectCreateDialog } from './project-create-dialog.js'
import { ProjectFolderSetup } from './project-folder-setup.js'
import { projectLifecycleApi } from './project-lifecycle-api.js'
import { ProjectSettingsSection } from './project-settings-section.js'

const directoryFlowSlotNames: readonly DirectoryFlowSlotName[] = ['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow']

const directoryFlowLabels = { heading: 'Add workspace' } satisfies { readonly heading: string }

type DirectoryFlowView = 'browse' | 'clone' | 'create' | 'inspect'

const DirectoryFlowContent = (props: DirectoryFlowOwnerProps & WorkspacePickerPorts): JSX.Element => {
  const browserApi = useApi(workspaceFolderBrowserApi)
  const lifecycleApi = useApi(projectLifecycleApi)
  const [view, setView] = useState<DirectoryFlowView>('browse')
  const [candidate, setCandidate] = useState<string | null>(null)
  const tools = useQuery({ queryKey: ['workspace-folder-picker', 'project-tools'], queryFn: () => lifecycleApi.tools({}), retry: false, staleTime: 60_000 })
  const pickerCapabilities = useQuery({
    queryKey: ['workspace-folder-picker', 'capabilities'],
    queryFn: ({ signal }) => browserApi.capabilities({}, { signal }),
    retry: false,
    staleTime: 60_000,
    // The flow mounts again on every opening, and a read that failed on the previous one must not hide Browse… for the
    // rest of the session: it is dropped with the mount instead of being cached.
    gcTime: 0,
  })
  const directoryPicker: DirectoryPickerPort = {
    pick: signal => props.directoryPicker.pick(signal),
    list: (path, signal) => browserApi.list(path === undefined ? {} : { path }, { signal }),
    createDirectory: (path, name) => browserApi.createDirectory({ path, name }),
  }
  if (view === 'inspect' && candidate !== null) {
    return (
      <ProjectFolderSetup
        api={lifecycleApi}
        path={candidate}
        onAdded={path => props.onPicked(path)}
        onClose={() => {
          setCandidate(null)
          setView('browse')
        }}
      />
    )
  }
  if (view === 'clone') {
    return <ProjectCloneDialog api={lifecycleApi} home={tools.data?.home} onClose={() => setView('browse')} onCloned={path => props.onPicked(path)} />
  }
  if (view === 'create') {
    return (
      <ProjectCreateDialog
        api={lifecycleApi}
        gitHubAvailable={tools.data?.gh === true}
        home={tools.data?.home}
        onClose={() => setView('browse')}
        onCreated={path => props.onPicked(path)}
      />
    )
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
        <DropdownMenuItem disabled={!tools.data.jj} onSelect={() => setView('create')}>
          <FolderPlusIcon aria-hidden />
          New project…
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
      showNativePicker={pickerCapabilities.data?.nativePicker === true}
      pathStyle={pickerCapabilities.data?.pathStyle}
      onClose={props.onCancel}
      onRegisterWorkspace={props.registerWorkspace}
      onUseAbsolutePath={path => {
        setCandidate(path)
        setView('inspect')
      }}
      onSelect={selection =>
        selection.kind === 'workspace'
          ? props.onPicked(selection.canonicalPath)
          : (() => {
              setCandidate(selection.canonicalPath)
              setView('inspect')
            })()
      }
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
    ctx.slots.inject('settings.section', () =>
      ctx.slots.register(
        {
          name: 'settings.section',
          registrant: '@dshfiles/workspace-folder-picker',
          id: 'dshfiles-workspace-folder-picker-projects',
          order: 34,
          label: () => 'Projects',
        },
        decorate(() => (
          <PluginQueryProvider>
            <ProjectSettingsSection />
          </PluginQueryProvider>
        )),
      ),
    )
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
