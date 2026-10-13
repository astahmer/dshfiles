import type { EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { ProjectFolderPicker, type ProjectFolderSelection, type RegisteredProject, type WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { useApi } from '@dshfiles/dshx/client'
import { hostDestination, multiHostApi, multiHostQueries } from '@dshfiles/multi-host/destination'
import { useEffect, useState } from 'react'
import { jjIntegrationApi } from './api.js'
import { DestinationBar, HostChipSlot, type DestinationBarServices } from './destination-bar.js'
import type { JjIntegrationTranslate } from './locales.js'
import { RemoteDestinationChips } from './remote-destination.js'

const NO_FOLDER_ID = 'dshfiles:no-folder'

/**
 * Replaces the native New-thread project picker: registered projects without the per-thread workspaces, a
 * "No folder" entry, and folder browsing to add a project. A chosen project goes through jj-integration so the
 * isolate-by-default setting applies here too.
 */
export const HeroWorkspacePicker = (
  props: EmptyWorkspaceOwnerProps & { readonly ports: WorkspacePickerPorts; readonly services: DestinationBarServices; readonly t: JjIntegrationTranslate },
) => {
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
    enabled: props.open && !remote,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.projects({}, { signal: hostSignal }) }),
  })
  if (destination.kind === 'runtime') {
    const runtime = directory.data?.runtimes.find(item => item.id === destination.runtimeId)
    const hostName = directory.data?.hosts.find(host => host.id === runtime?.hostId)?.name ?? runtime?.name ?? 'Remote host'
    return (
      // The native project chip names a folder of this machine; while a remote host is chosen it is hidden (client.css).
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
  const bar = <DestinationBar workspaceId={props.selectedId} services={props.services} t={props.t} />
  if (!props.open) return bar

  const registered: RegisteredProject[] = [
    { workspaceId: NO_FOLDER_ID, title: props.t('noFolder'), canonicalPath: '~/.dsh/no-folder' },
    ...(projects.data?.projects ?? []).map(project => ({ workspaceId: project.workspaceId, title: project.title, canonicalPath: project.path })),
  ]

  const choose = async (selection: ProjectFolderSelection): Promise<void> => {
    const workspaceId =
      selection.kind === 'workspace'
        ? selection.workspaceId === NO_FOLDER_ID
          ? (await api.noFolder({})).workspaceId
          : selection.workspaceId
        : (await props.ports.registerWorkspace(selection.canonicalPath)).workspaceId
    const destination = selection.kind === 'workspace' && selection.workspaceId === NO_FOLDER_ID ? { workspaceId } : await api.provision({ workspaceId })
    // SAFETY: both ids come from the Host's workspace registry.
    props.onPick(destination.workspaceId as Parameters<EmptyWorkspaceOwnerProps['onPick']>[0])
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
        title={props.t('chooseProject')}
      />
    </>
  )
}
