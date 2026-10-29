import { homedir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-subprocess'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import BrowseDirectoryPicker from '@deepseek-ai/dsh-host-directory-picker-browse'
import { PluginApiError } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'
import { createCloneJobs, type CommandRunner, type ProjectCommand, type ProjectLifecycleDeps } from './project-lifecycle.js'
import { projectLifecycleApi } from './project-lifecycle-api.js'

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

  let hostContext: Context | undefined
  const requireContext = (): Context => {
    if (hostContext === undefined) throw new PluginApiError('Project actions are unavailable until the Host finishes starting.', { code: 'host-starting' })
    return hostContext
  }
  const run: CommandRunner = async input => {
    const handle = requireContext().subprocess.spawn({
      argv: [...input.argv],
      cwd: input.cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 64 * 1024 }, stderr: 'pipe' },
      graceMs: 1_500,
      signal: input.signal,
    })
    let stderr = ''
    handle.stderr?.setEncoding('utf8')
    handle.stderr?.on('data', (text: string) => {
      stderr = (stderr + text).slice(-16 * 1024)
      input.onStderr?.(text)
    })
    const outcome = await handle.done
    return { exitCode: outcome.exitCode ?? 1, stdout: handle.collected.stdout?.readFrom(0).text ?? '', stderr }
  }
  const deps: ProjectLifecycleDeps = {
    run,
    resolve: (command: ProjectCommand) =>
      requireContext()
        .subprocess.resolveExecutable(command)
        .catch(() => undefined),
    register: async path => {
      const created = await requireContext().workspaceController.create({ path })
      return { workspaceId: created.workspace.workspaceId, title: created.workspace.title, path: created.workspace.path }
    },
    home: homedir,
  }
  const cloneJobs = createCloneJobs(deps)
  const lifecycleApi = projectLifecycleApi.host({
    tools: async () => {
      const [git, jj, gh] = await Promise.all((['git', 'jj', 'gh'] as const).map(command => deps.resolve(command)))
      return { home: homedir(), git: git !== undefined, jj: jj !== undefined, gh: gh !== undefined }
    },
    startClone: request => cloneJobs.start(request.input),
    cloneJobs: async () => ({ jobs: cloneJobs.list() }),
    cancelClone: async request => cloneJobs.cancel(request.input.jobId),
  })

  return defineHost({
    name: 'dshfiles-workspace-folder-picker',
    inject: ['subprocess', 'workspaceController'],
    apis: [api, lifecycleApi],
    setup(ctx) {
      hostContext = ctx
      ctx.effect(
        () => () => {
          cloneJobs.dispose()
          if (hostContext === ctx) hostContext = undefined
        },
        'workspace-folder-picker clone jobs',
      )
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
