import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { DirectoryFlowOwnerProps, DirectoryFlowSlotName } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useApi, useSettings } from '@dshfiles/dshx/client'
import { PaletteActions } from '@dshfiles/command-palette/palette-contract'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { FolderPlusIcon, GitBranchIcon } from '@dshfiles/plugin-ui/icons'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { createWorkspacePickerPorts, ProjectFolderPicker, type DirectoryPickerPort, type WorkspacePickerPorts } from './picker/index.js'
import { useEffect, useState } from 'react'
import { ProjectAddFlow, type ProjectAddView } from './project-add-flow.js'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'
import { CloneJobsNoticeHost } from './clone-jobs-notice.js'
import { ProjectCloneDialog } from './project-clone-dialog.js'
import { ProjectCreateDialog } from './project-create-dialog.js'
import { ProjectFolderSetup } from './project-folder-setup.js'
import { projectLifecycleApi } from './project-lifecycle-api.js'
import { ProjectAddChooser } from './project-add-chooser.js'
import { upsertProjectTone } from './project-tone.js'
import { workspaceFolderPickerSettings } from './settings.js'
import { ProjectSettingsSection } from './project-settings-section.js'

const directoryFlowSlotNames: readonly DirectoryFlowSlotName[] = ['sidebar.workspaces.directoryFlow', 'conversation.hero.workspace.directoryFlow']

const directoryFlowLabels = { heading: 'Add a project' } satisfies { readonly heading: string }

type DirectoryFlowView = 'choose' | 'browse' | 'clone' | 'create' | 'inspect'

const DirectoryFlowContent = (props: DirectoryFlowOwnerProps & WorkspacePickerPorts & { readonly initialView?: DirectoryFlowView }): JSX.Element => {
  const browserApi = useApi(workspaceFolderBrowserApi)
  const lifecycleApi = useApi(projectLifecycleApi)
  const settings = useSettings(workspaceFolderPickerSettings)
  /** The colour chosen in the import dialog outlives it: chips and project labels read the same entry. */
  const picked = (path: string, tone: number): void => {
    void settings.set('projectTones', upsertProjectTone(settings.value?.projectTones ?? [], path, tone)).catch(() => undefined)
    props.onPicked(path)
  }
  // A surface that asked for New project or Clone (ProjectAddFlow.request) opens the flow on that view; the Host's own
  // add-workspace hole opens on the chooser instead of dropping the operator into a filesystem listing.
  const [view, setView] = useState<DirectoryFlowView>(() => props.initialView ?? 'choose')
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
  if (view === 'choose') {
    return (
      <ProjectAddChooser
        gitHubAvailable={tools.data?.gh === true}
        onBrowse={() => setView('browse')}
        onClone={() => setView('clone')}
        onClose={props.onCancel}
        onCreate={() => setView('create')}
        open
      />
    )
  }
  if (view === 'inspect' && candidate !== null) {
    return (
      <ProjectFolderSetup
        api={lifecycleApi}
        path={candidate}
        onAdded={picked}
        onClose={() => {
          setCandidate(null)
          setView('browse')
        }}
      />
    )
  }
  if (view === 'clone') {
    return <ProjectCloneDialog api={lifecycleApi} home={tools.data?.home} onClose={() => setView('browse')} onCloned={picked} />
  }
  if (view === 'create') {
    return (
      <ProjectCreateDialog
        api={lifecycleApi}
        gitHubAvailable={tools.data?.gh === true}
        home={tools.data?.home}
        onClose={() => setView('browse')}
        onCreated={picked}
      />
    )
  }
  // New project and Clone were hidden behind a "New ▾" button (productivity pass Q5, T5.5): both are direct buttons.
  const addActions = tools.isSuccess ? (
    <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
      <Button className="dshx:shrink-0" disabled={props.busy || !tools.data.jj} type="button" variant="outline" onClick={() => setView('create')}>
        <FolderPlusIcon aria-hidden />
        New project…
      </Button>
      <Button className="dshx:shrink-0" disabled={props.busy || !tools.data.git} type="button" variant="outline" onClick={() => setView('clone')}>
        <GitBranchIcon aria-hidden />
        Clone repository…
      </Button>
    </div>
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
      placeholder="Browse for a project folder…"
      projects={[]}
    />
  )
}

/**
 * The same flow in its own dialog, for surfaces that do not own a native directory-flow hole (the thread list's project
 * picker, ⌘K): ProjectAddFlow.open('browse' | 'create' | 'clone'). Every path registers the project on the Host
 * (project_register / project_create / project_clone), so picking only closes the dialog.
 */
const ProjectAddFlowHost = (props: WorkspacePickerPorts): JSX.Element | null => {
  const [open, setOpen] = useState(false)
  useEffect(
    () =>
      ProjectAddFlow.handle((view: ProjectAddView) => {
        ProjectAddFlow.request(view)
        setOpen(false)
        // A fresh mount reads the requested view.
        queueMicrotask(() => setOpen(true))
      }),
    [],
  )
  if (!open) return null
  const close = (): void => setOpen(false)
  return (
    <PluginQueryProvider>
      <DirectoryFlowContent {...props} initialView={ProjectAddFlow.take()} open busy={false} onPicked={close} onCancel={close} onError={() => undefined} />
    </PluginQueryProvider>
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
  setup(ctx, decorate, metadata) {
    const ports = createWorkspacePickerPorts(ctx.remote)
    // Users asked agents to create or add projects (productivity pass Q5, T5.5): ⌘K offers both directly.
    const plugin = metadata?.plugin
    if (plugin !== undefined)
      for (const row of [
        { id: 'new-project', label: 'New project…', view: 'create', aliases: ['Create project', 'Initialize repository', 'New repository'] },
        { id: 'add-folder', label: 'Add folder as project…', view: 'browse', aliases: ['Open folder', 'Add workspace', 'Register project'] },
        { id: 'clone-repository', label: 'Clone repository…', view: 'clone', aliases: ['git clone', 'Clone project'] },
      ] as const)
        plugin.add(PaletteActions, {
          id: `@dshfiles/workspace-folder-picker/${row.id}`,
          group: 'command',
          label: row.label,
          aliases: row.aliases,
          run: () => {
            ProjectAddFlow.open(row.view)
          },
        })
    // A clone outlives the dialog that started it; the shell overlay keeps its phase and retry on screen.
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-workspace-folder-picker-clones', order: 118 },
        decorate(() => (
          <PluginQueryProvider>
            <CloneJobsNoticeHost />
          </PluginQueryProvider>
        )),
      ),
    )
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        { name: 'shell.overlay', id: 'dshfiles-workspace-folder-picker-project-add', order: 119 },
        decorate(() => <ProjectAddFlowHost {...ports} />),
      ),
    )
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
