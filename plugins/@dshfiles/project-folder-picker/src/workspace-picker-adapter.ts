import type { DirectoryListing, DirectoryPickerPort, RegisteredProject } from './project-folder-picker.js'

type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }

export interface WorkspacePickerRemote {
  readonly directoryPicker: {
    readonly pick: (signal?: AbortSignal) => Promise<RemoteResult<string | null>>
    readonly list: (path?: string, signal?: AbortSignal) => Promise<RemoteResult<DirectoryListing>>
    readonly createDirectory: (path: string, name: string) => Promise<RemoteResult<string>>
  }
  readonly workspace: {
    readonly create: (input: { readonly path: string }) => Promise<
      RemoteResult<{
        readonly workspace: { readonly workspaceId: string; readonly path: string; readonly title: string }
        readonly created: boolean
      }>
    >
  }
}

export interface WorkspacePickerPorts {
  readonly directoryPicker: DirectoryPickerPort
  readonly registerWorkspace: (canonicalPath: string) => Promise<RegisteredProject>
}

export const createWorkspacePickerPorts = (remote: WorkspacePickerRemote): WorkspacePickerPorts => ({
  directoryPicker: {
    pick: async signal => {
      const result = await remote.directoryPicker.pick(signal)
      if (!result.ok) throw new Error('Folder picking is unavailable.')
      return result.value
    },
    list: async (path, signal) => {
      const result = await remote.directoryPicker.list(path, signal)
      if (!result.ok) throw new Error('Folder browsing is unavailable.')
      return result.value
    },
    createDirectory: async (path, name) => {
      const result = await remote.directoryPicker.createDirectory(path, name)
      if (!result.ok) throw new Error('Folder creation is unavailable.')
      return result.value
    },
  },
  registerWorkspace: async canonicalPath => {
    const result = await remote.workspace.create({ path: canonicalPath })
    if (!result.ok) throw new Error('Workspace registration was refused.')
    return {
      workspaceId: result.value.workspace.workspaceId,
      title: result.value.workspace.title,
      canonicalPath: result.value.workspace.path,
    }
  },
})
