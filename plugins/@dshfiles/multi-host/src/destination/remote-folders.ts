import type { DirectoryListing } from '../api.js'
import type { MultiHostClient } from './queries.js'

/** Folder browsing on a remote host, shaped like the project picker's DirectoryPickerPort. */
export const remoteDirectoryPicker = (api: MultiHostClient, runtimeId: string) => ({
  pick: async (): Promise<string | null> => {
    throw new Error('The native folder chooser only opens on this machine; browse the host instead.')
  },
  list: async (path: string | undefined, signal: AbortSignal): Promise<DirectoryListing> => {
    const result = await api.runtimeBrowse({ runtimeId, ...(path === undefined ? {} : { path }) }, { signal })
    if (!result.ok) throw new Error(`${result.message} (${result.code})`)
    return { path: result.path, home: result.home, crumbs: result.crumbs, entries: result.entries, truncated: result.truncated }
  },
  createDirectory: async (path: string, name: string): Promise<string> => {
    const result = await api.runtimeCreateDirectory({ runtimeId, path, name })
    if (!result.ok) throw new Error(`${result.message} (${result.code})`)
    return result.path
  },
})
