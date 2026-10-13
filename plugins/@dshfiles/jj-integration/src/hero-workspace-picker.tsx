import type { EmptyWorkspaceOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { runHostRequest } from '@dshfiles/plugin-ui/lib/host-request'
import { useQuery } from '@dshfiles/plugin-ui/query'
import { ProjectFolderPicker, type ProjectFolderSelection, type RegisteredProject, type WorkspacePickerPorts } from '@dshfiles/project-folder-picker'
import { useApi } from '@dshfiles/dshx/client'
import { jjIntegrationApi } from './api.js'
import { DestinationBar, type DestinationBarServices } from './destination-bar.js'
import type { JjIntegrationTranslate } from './locales.js'

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
  const projects = useQuery({
    queryKey: ['jj-integration', 'projects'],
    enabled: props.open,
    queryFn: ({ signal }) => runHostRequest({ signal, timeoutMs: 30_000, request: hostSignal => api.projects({}, { signal: hostSignal }) }),
  })
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
