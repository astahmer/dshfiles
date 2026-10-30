import type { EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { workspaceListed } from '@dshfiles/plugin-ui/lib/workspace-listed'
import { errorMessage, useQuery } from '@dshfiles/plugin-ui/query'
import {
  ProjectFolderPicker,
  type DirectoryPickerPort,
  type ProjectFolderSelection,
  type RegisteredProject,
  type WorkspacePickerPorts,
} from '@dshfiles/project-folder-picker'
import { useApi } from '@dshfiles/dshx/client'
import { workspaceFolderBrowserApi } from '@dshfiles/workspace-folder-picker/directory-browser-api'
import { projectLifecycleApi } from '@dshfiles/workspace-folder-picker/project-lifecycle-api'
import { hostDestination, multiHostApi, multiHostQueries, RemoteSessionBootstrap, shouldBootstrapRemoteSession } from '@dshfiles/multi-host/destination'
import { useLayoutEffect, useState } from 'react'
import { jjIntegrationApi } from './api.js'
import { mainViewSessionId } from './main-view-session.js'
import { DestinationBar, HostChipSlot, type DestinationBarServices, type WorkspaceToggleActor } from './destination-bar.js'
import type { JjIntegrationTranslate } from './locales.js'
import { prepareRemoteFolder, RemoteDestinationChips } from './remote-destination.js'
import { recentProjectPaths } from './recent-projects.js'

const NO_FOLDER_ID = 'dshfiles:no-folder'
const NO_FOLDER_PATH_SUFFIX = '/.dsh/no-folder'
const RECENT_PROJECT_COUNT = 5
const pinnedWorkspaceIds = [NO_FOLDER_ID]

/**
 * Replaces the native New-thread project picker: registered projects first, the per-thread workspaces on their own
 * tab, a "No folder" entry, and folder browsing to add a project. A chosen project goes through jj-integration so the
 * isolate-by-default setting applies here too.
 */
export const HeroWorkspacePicker = (
  props: EmptyWorkspaceOwnerProps & {
    readonly ports: WorkspacePickerPorts
    readonly services: DestinationBarServices
    readonly toggle: WorkspaceToggleActor
    readonly t: JjIntegrationTranslate
  },
) => {
  const { services, onPick } = props
  useLayoutEffect(
    () =>
      services.bindWorkspacePicker(workspaceId => {
        // SAFETY: the destination was returned by the Host's workspace registry.
        onPick(workspaceId as Parameters<EmptyWorkspaceOwnerProps['onPick']>[0])
      }),
    [services, onPick],
  )
  const api = useApi(jjIntegrationApi)
  const browserApi = useApi(workspaceFolderBrowserApi)
  const lifecycleApi = useApi(projectLifecycleApi)
  const directoryPicker: DirectoryPickerPort = {
    pick: signal => props.ports.directoryPicker.pick(signal),
    list: (path, signal) => browserApi.list(path === undefined ? {} : { path }, { signal }),
    createDirectory: (path, name) => browserApi.createDirectory({ path, name }),
  }
  const multiHost = useApi(multiHostApi)
  const destination = hostDestination.useValue()
  const [remotePickerOpen, setRemotePickerOpen] = useState(false)
  const directory = useQuery({ ...multiHostQueries.directory(multiHost), enabled: destination.kind === 'runtime' })
  const currentSessionId = mainViewSessionId(services.sessions.list.getSnapshot())
  const currentSessionOwner = useQuery({
    queryKey: ['multi-host', 'session-runtime', currentSessionId],
    enabled: destination.kind === 'runtime' && currentSessionId !== undefined,
    retry: false,
    queryFn: async ({ signal }) => {
      if (currentSessionId === undefined) return null
      const result = await multiHost.sessionRuntime({ sessionId: currentSessionId }, { signal })
      if (!result.ok) throw new Error(result.message)
      return result.runtimeId
    },
  })
  const remote = destination.kind === 'runtime'
  const localProjectPath = services.workspaces.list.getSnapshot().items.find(item => item.workspaceId === props.selectedId)?.path
  const bootstrapRemoteSession =
    destination.kind === 'runtime' &&
    shouldBootstrapRemoteSession({
      currentSessionId,
      ownerKnown: currentSessionId === undefined || currentSessionOwner.isSuccess,
      ownerRuntimeId: currentSessionOwner.data,
      destinationRuntimeId: destination.runtimeId,
    })
  const projects = useQuery({
    queryKey: ['jj-integration', 'projects'],
    enabled: !remote,
    // Every New thread remounts this picker, and the Host classifies each registered workspace against jj; the
    // registered list changes only when a folder is added, so a remount reuses it instead of rescanning the store.
    staleTime: 60_000,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.projects({}, { signal: hostSignal }) }),
  })
  if (destination.kind === 'runtime') {
    const runtime = directory.data?.runtimes.find(item => item.id === destination.runtimeId)
    const hostName = directory.data?.hosts.find(host => host.id === runtime?.hostId)?.name ?? runtime?.name ?? 'Remote host'
    return (
      // The native project chip names a folder of this machine; while a remote host is chosen it is hidden (remoteDestinationSheet in client.tsx).
      <div className="dshx-root dshx:contents" aria-label={props.t('destination')} data-remote-destination="">
        <HostChipSlot localProjectPath={localProjectPath} />
        {bootstrapRemoteSession ? (
          <RemoteSessionBootstrap
            api={multiHost}
            runtimeId={destination.runtimeId}
            hostName={hostName}
            cwd={destination.folder}
            prepareCwd={() => prepareRemoteFolder(multiHost, destination)}
            onStarted={props.services.openSession}
          />
        ) : currentSessionId !== undefined && currentSessionOwner.isError ? (
          <p role="alert" className="dshx:text-xs dshx:text-destructive">
            Could not verify whether this thread is remote ({errorMessage(currentSessionOwner.error, 'unknown error')}). Reload the page to retry.
          </p>
        ) : currentSessionId !== undefined && !currentSessionOwner.isSuccess ? (
          <p role="status" className="dshx:text-xs dshx:text-muted-foreground">
            Checking the current thread's host…
          </p>
        ) : null}

        <RemoteDestinationChips
          api={multiHost}
          destination={destination}
          hostName={hostName}
          pickerOpen={props.open || remotePickerOpen}
          onPickerOpenChange={open => {
            setRemotePickerOpen(open)
            if (!open && props.open) props.onClose()
          }}
          t={props.t}
        />
      </div>
    )
  }
  const bar = <DestinationBar workspaceId={props.selectedId} services={props.services} toggle={props.toggle} t={props.t} />
  if (!props.open) return bar

  // The Host lists both by last use; its own "No folder" registration is the entry offered first here.
  const hostProjects = (projects.data?.projects ?? []).filter(project => !project.path.endsWith(NO_FOLDER_PATH_SUFFIX))
  const registered: RegisteredProject[] = [
    { workspaceId: NO_FOLDER_ID, title: props.t('noFolder'), canonicalPath: '~/.dsh/no-folder', removable: false },
    ...hostProjects.map(project => ({ workspaceId: project.workspaceId, title: project.title, canonicalPath: project.path })),
    ...(projects.data?.workspaces ?? []).map(workspace => ({
      workspaceId: workspace.workspaceId,
      title: workspace.title,
      canonicalPath: workspace.path,
      isJjWorkspace: true,
    })),
  ]
  // Read once per open rather than subscribed: every Session event would otherwise re-render the destination bar.
  const recentFolders = recentProjectPaths({
    threads: Object.values(props.services.sessions.list.getSnapshot().byId).flatMap(session =>
      session === undefined ? [] : [{ cwd: session.cwd, updatedAt: session.updatedAt, blank: session.blank }],
    ),
    projectPaths: hostProjects.map(project => project.path),
    limit: RECENT_PROJECT_COUNT,
  })

  // The composer moves to the chosen project at once; the destination bar then gives the thread its own workspace in
  // the background when isolation is the default, so nothing here waits on jj.
  const choose = async (selection: ProjectFolderSelection): Promise<void> => {
    const workspaceId =
      selection.kind === 'workspace'
        ? selection.workspaceId === NO_FOLDER_ID
          ? (await api.noFolder({})).workspaceId
          : selection.workspaceId
        : (await props.ports.registerWorkspace(selection.canonicalPath)).workspaceId
    if (selection.kind === 'directory') await projects.refetch()
    await workspaceListed({ workspaces: props.services.workspaces, workspaceId })
    // SAFETY: the id comes from the Host's workspace registry.
    props.onPick(workspaceId as Parameters<EmptyWorkspaceOwnerProps['onPick']>[0])
  }

  return (
    <>
      {bar}
      <ProjectFolderPicker
        projects={registered}
        recentFolders={recentFolders}
        pinnedWorkspaceIds={pinnedWorkspaceIds}
        directoryPicker={directoryPicker}
        onRegisterWorkspace={async path => {
          const project = await props.ports.registerWorkspace(path)
          await projects.refetch()
          return project
        }}
        onRemoveProject={async project => {
          await lifecycleApi.removeProject({ workspaceId: project.workspaceId })
          await projects.refetch()
        }}
        onSelect={selection => void choose(selection).catch(() => props.onClose())}
        onClose={props.onClose}
        showNativePicker={false}
        disabled={projects.isLoading}
        loading={projects.isLoading}
        heading={props.t('chooseProject')}
      />
    </>
  )
}
