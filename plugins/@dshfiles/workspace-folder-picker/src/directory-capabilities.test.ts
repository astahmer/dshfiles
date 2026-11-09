import DirectoryPicker, { type DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import BrowseDirectoryPicker from '@deepseek-ai/dsh-host-directory-picker-browse'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'
import plugin from './host.js'
import { projectLifecycleApi } from './project-lifecycle-api.js'
import { ProjectFolderPickerModel } from './picker/project-folder-picker-model.js'

let nativePicks = 0

/** A native backend that counts dialog openings, so a capability read can prove it opened none. */
class CountingNativePicker extends DirectoryPicker {
  capability(): DirectoryPickerCapability {
    return {
      kind: 'native',
      pick: async () => {
        nativePicks += 1
        return null
      },
    }
  }
}

const mountedPicker = (
  backend: 'native' | 'browse' | 'none',
  workspaces: readonly { readonly id: string; readonly title: string; readonly path: string }[] = [],
) =>
  Effect.gen(function* () {
    nativePicks = 0
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      created => Effect.promise(() => created.dispose()),
    )
    // SAFETY: capability reads and folder listing never call the project services this plugin injects.
    const releaseServices = [
      host.ctx.provide('subprocess', {} as never),
      host.ctx.provide('workspaceController', {} as never),
      host.ctx.provide('workspaceRegistry', { list: () => workspaces } as never),
    ]
    yield* Effect.addFinalizer(() => Effect.sync(() => releaseServices.forEach(release => release())))
    const picker =
      backend === 'none'
        ? undefined
        : yield* Effect.promise(async () =>
            backend === 'native' ? host.ctx.plugin(CountingNativePicker) : host.ctx.plugin(BrowseDirectoryPicker, { maxEntries: 10 }),
          )
    yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/workspace-folder-picker' }))
    return {
      picker,
      api: createHostApiClient(host.ctx, workspaceFolderBrowserApi, '@test/capabilities'),
      lifecycle: createHostApiClient(host.ctx, projectLifecycleApi, '@test/lifecycle'),
    }
  })

describe('directory picker capabilities', () => {
  it.live('reports the native dialog without opening it', () =>
    Effect.gen(function* () {
      const { api } = yield* mountedPicker('native')
      expect(yield* Effect.promise(() => api.capabilities({}))).toMatchObject({ nativePicker: true })
      expect(nativePicks).toBe(0)
    }),
  )

  it.live('keeps the in-app folder browser when the Host picker is browse-only', () =>
    Effect.gen(function* () {
      const { api } = yield* mountedPicker('browse')
      expect(yield* Effect.promise(() => api.capabilities({}))).toMatchObject({ nativePicker: false })
      expect(yield* Effect.promise(() => api.list({}))).toMatchObject({ path: expect.any(String), home: expect.any(String), entries: expect.any(Array) })
    }),
  )

  it.live('keeps the in-app folder browser when the Host has no picker', () =>
    Effect.gen(function* () {
      const { api } = yield* mountedPicker('none')
      expect(yield* Effect.promise(() => api.capabilities({}))).toMatchObject({ nativePicker: false })
      expect(yield* Effect.promise(() => api.list({}))).toMatchObject({ path: expect.any(String), home: expect.any(String) })
    }),
  )

  it.live('stops offering the native dialog once the Host picker is unloaded', () =>
    Effect.gen(function* () {
      const { api, picker } = yield* mountedPicker('native')
      expect(yield* Effect.promise(() => api.capabilities({}))).toMatchObject({ nativePicker: true })
      yield* Effect.promise(async () => picker?.dispose())
      expect(yield* Effect.promise(() => api.capabilities({}))).toMatchObject({ nativePicker: false })
    }),
  )

  it.live('reports the path style of the folders it lists', () =>
    Effect.gen(function* () {
      const { api } = yield* mountedPicker('browse')
      const listing = yield* Effect.promise(() => api.list({}))
      expect((yield* Effect.promise(() => api.capabilities({}))).pathStyle).toBe(ProjectFolderPickerModel.pathStyleOf(listing.home))
    }),
  )

  it.effect('exposes the capability read as a read-only agent tool', () =>
    Effect.sync(() => {
      expect(workspaceFolderBrowserApi.methods.capabilities.tool).toMatchObject({ name: 'workspace_folder_browser_capabilities', readOnly: true })
    }),
  )

  it.live('lists registered projects and leaves jj thread workspaces out', () =>
    Effect.gen(function* () {
      const { lifecycle } = yield* mountedPicker('none', [
        { id: 'project-1', title: 'dshfiles', path: '/Users/me/dev/dshfiles' },
        { id: 'thread-1', title: 'thread', path: '/Users/me/dev/dshfiles-threads/thread-7ce777' },
      ])
      expect(yield* Effect.promise(() => lifecycle.projects({}))).toEqual({
        projects: [{ workspaceId: 'project-1', title: 'dshfiles', path: '/Users/me/dev/dshfiles' }],
      })
      expect(projectLifecycleApi.methods.projects.tool).toMatchObject({ name: 'project_projects', readOnly: true })
    }),
  )
})
