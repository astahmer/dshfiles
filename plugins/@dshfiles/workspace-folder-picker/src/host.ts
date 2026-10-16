import { Context } from '@deepseek-ai/cordis'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import BrowseDirectoryPicker from '@deepseek-ai/dsh-host-directory-picker-browse'
import { PluginApiError } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'

type BrowseCapability = Extract<ReturnType<BrowseDirectoryPicker['capability']>, { kind: 'browse' }>

const createHost = () => {
  let browseCapability: BrowseCapability | undefined
  const api = workspaceFolderBrowserApi.host({
    list: async request => {
      if (browseCapability === undefined) {
        throw new PluginApiError('Folder browsing is unavailable.', { code: 'folder-browser-unavailable' })
      }
      request.signal.throwIfAborted()
      try {
        return await browseCapability.list(request.input.path, request.signal)
      } catch {
        request.signal.throwIfAborted()
        throw new PluginApiError('Could not open this folder.', { code: 'directory-unreadable' })
      }
    },
    createDirectory: async request => {
      if (browseCapability === undefined) {
        throw new PluginApiError('Folder browsing is unavailable.', { code: 'folder-browser-unavailable' })
      }
      request.signal.throwIfAborted()
      try {
        return await browseCapability.createDirectory(request.input.path, request.input.name)
      } catch (error) {
        request.signal.throwIfAborted()
        if (error instanceof DirectoryPickerError && error.code === 'directory-exists') {
          throw new PluginApiError('A folder with that name already exists.', { code: 'directory-exists' })
        }
        throw new PluginApiError('Could not create this folder.', { code: 'directory-create-failed' })
      }
    },
  })

  return defineHost({
    name: 'dshfiles-workspace-folder-picker',
    apis: [api],
    setup(ctx) {
      const browseContext = new Context()
      const picker = new BrowseDirectoryPicker(browseContext, { maxEntries: 1_000 })
      ctx.effect(
        () => async () => {
          browseCapability = undefined
          await browseContext.fiber.dispose()
        },
        'workspace-folder-picker directory browser',
      )
      const capability = picker.capability()
      if (capability.kind !== 'browse') throw new Error('The directory browser did not provide its browse capability.')
      browseCapability = capability
    },
  })
}

export default createHost()
