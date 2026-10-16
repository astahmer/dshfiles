import type { EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { ProjectFolderPicker, type ProjectFolderSelection, type RegisteredProject, type WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { useApi } from '@dshfiles/dshx/client'
import { hostDestination, multiHostApi, multiHostQueries } from '@dshfiles/multi-host/destination'
import { useEffect, useLayoutEffect, useState } from 'react'
import { jjIntegrationApi } from './api.js'
import { DestinationBar, HostChipSlot, type DestinationBarServices, type WorkspaceToggleActor, workspaceListed } from './destination-bar.js'
import type { JjIntegrationTranslate } from './locales.js'
import { RemoteDestinationChips } from './remote-destination.js'

const NO_FOLDER_ID = 'dshfiles:no-folder'

/**
 * Replaces the native New-thread project picker: registered projects without the per-thread workspaces, a
 * "No folder" entry, and folder browsing to add a project. A chosen project goes through jj-integration so the
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
  const multiHost = useApi(multiHostApi)
  const destination = hostDestination.useValue()
  const [remotePickerOpen, setRemotePickerOpen] = useState(false)
  const directory = useQuery({ ...multiHostQueries.directory(multiHost), enabled: destination.kind === 'runtime' })
  const remote = destination.kind === 'runtime'
  const takeOverComposer = props.services.takeOverComposer
  useEffect(() => (remote ? takeOverComposer() : undefined), [remote, takeOverComposer])
  const projects = useQuery({
    queryKey: ['jj-integration', 'projects'],
    enabled: !remote,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.projects({}, { signal: hostSignal }) }),
  })
  if (destination.kind === 'runtime') {
    const runtime = directory.data?.runtimes.find(item => item.id === destination.runtimeId)
    const hostName = directory.data?.hosts.find(host => host.id === runtime?.hostId)?.name ?? runtime?.name ?? 'Remote host'
    return (
      // The native project chip names a folder of this machine; while a remote host is chosen it is hidden (remoteDestinationSheet in client.tsx).
      <div className="dshx-root dshx:contents" aria-label={props.t('destination')} data-remote-destination="">
        <HostChipSlot />
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

  const registered: RegisteredProject[] = [
    { workspaceId: NO_FOLDER_ID, title: props.t('noFolder'), canonicalPath: '~/.dsh/no-folder' },
    ...(projects.data?.projects ?? []).map(project => ({ workspaceId: project.workspaceId, title: project.title, canonicalPath: project.path })),
  ]

  // The composer moves to the chosen project at once; the destination bar then gives the thread its own workspace in
  // the background when isolation is the default, so nothing here waits on jj.
  const choose = async (selection: ProjectFolderSelection): Promise<void> => {
    const workspaceId =
      selection.kind === 'workspace'
        ? selection.workspaceId === NO_FOLDER_ID
          ? (await api.noFolder({})).workspaceId
          : selection.workspaceId
        : (await props.ports.registerWorkspace(selection.canonicalPath)).workspaceId
    await workspaceListed(props.services.workspaces, workspaceId)
    // SAFETY: the id comes from the Host's workspace registry.
    props.onPick(workspaceId as Parameters<EmptyWorkspaceOwnerProps['onPick']>[0])
  }

  return (
    <>
      {bar}
      <ProjectFolderPicker
        projects={registered}
        directoryPicker={props.ports.directoryPicker}
        onRegisterWorkspace={props.ports.registerWorkspace}
        onSelect={selection => void choose(selection).catch(() => props.onClose())}
        onClose={props.onClose}
        showNativePicker={false}
        disabled={projects.isLoading}
        loading={projects.isLoading}
        title={props.t('chooseProject')}
      />
    </>
  )
}
