import { homedir } from 'node:os'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'
import type {} from '@deepseek-ai/dsh-subprocess'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import BrowseDirectoryPicker from '@deepseek-ai/dsh-host-directory-picker-browse'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { PluginApiError } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import { Context as EffectContext, Effect, Layer, Schema } from 'effect'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'
import { createCloneJobs, createProject, type CommandRunner, type ProjectCommand, type ProjectLifecycleDeps } from './project-lifecycle.js'
import { projectLifecycleApi } from './project-lifecycle-api.js'

type BrowseCapability = Extract<ReturnType<BrowseDirectoryPicker['capability']>, { kind: 'browse' }>
type CloneJobs = ReturnType<typeof createCloneJobs>

class DirectoryUnreadable extends Schema.TaggedError<DirectoryUnreadable>()('DirectoryUnreadable', { message: Schema.String }) {}
class DirectoryAlreadyExists extends Schema.TaggedError<DirectoryAlreadyExists>()('DirectoryExists', { message: Schema.String }) {}
class DirectoryCreateFailed extends Schema.TaggedError<DirectoryCreateFailed>()('DirectoryCreateFailed', { message: Schema.String }) {}
class ProjectLifecycleFailure extends Schema.TaggedError<ProjectLifecycleFailure>()('ProjectLifecycleFailure', { message: Schema.String }) {}

class WorkspaceFolderRuntime extends EffectContext.Service<
  WorkspaceFolderRuntime,
  {
    readonly browse: BrowseCapability
    readonly cloneJobs: CloneJobs
    readonly deps: ProjectLifecycleDeps
    readonly removeProject: (workspaceId: string) => Promise<{ readonly workspaceId: string; readonly removed: true }>
  }
>()('@dshfiles/workspace-folder-picker/Runtime') {}

const toProjectLifecycleFailure = (error: unknown): PluginApiError | ProjectLifecycleFailure => {
  if (error instanceof PluginApiError) return error
  return new ProjectLifecycleFailure({ message: error instanceof Error ? error.message : String(error) })
}

const rootLayer = (ctx: CordisContext) =>
  Layer.effect(
    WorkspaceFolderRuntime,
    Effect.acquireRelease(
      Effect.sync(() => {
        const browseContext = new CordisContext()
        const picker = new BrowseDirectoryPicker(browseContext, { maxEntries: 1_000 })
        const capability = picker.capability()
        if (capability.kind !== 'browse') throw new Error('The directory browser did not provide its browse capability.')
        const run: CommandRunner = async input => {
          const handle = ctx.subprocess.spawn({
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
          resolve: (command: ProjectCommand) => ctx.subprocess.resolveExecutable(command).catch(() => undefined),
          register: async path => {
            const created = await ctx.workspaceController.create({ path })
            return { workspaceId: created.workspace.workspaceId, title: created.workspace.title, path: created.workspace.path }
          },
          home: homedir,
        }
        const cloneJobs = createCloneJobs(deps)
        return {
          browse: capability,
          cloneJobs,
          deps,
          removeProject: async (workspaceId: string) => {
            const id = WorkspaceId(workspaceId)
            await ctx.workspaceController.delete({ workspaceId: id })
            return { workspaceId: id, removed: true as const }
          },
          browseContext,
        }
      }),
      runtime =>
        Effect.promise(async () => {
          runtime.cloneJobs.dispose()
          await runtime.browseContext.fiber.dispose()
        }),
    ).pipe(Effect.map(runtime => ({ browse: runtime.browse, cloneJobs: runtime.cloneJobs, deps: runtime.deps, removeProject: runtime.removeProject }))),
  )

const { hostApi, ...effectPlugin } = DshxEffect.plugin({ layer: rootLayer, setup: () => Effect.void })

const browserApi = hostApi(workspaceFolderBrowserApi, {
  list: Effect.fn('workspace folder browse')(({ input, signal }) =>
    WorkspaceFolderRuntime.use(runtime =>
      Effect.tryPromise({
        try: () => runtime.browse.list(input.path, signal),
        catch: () => new DirectoryUnreadable({ message: 'Could not open this folder.' }),
      }),
    ),
  ),
  createDirectory: Effect.fn('workspace folder create directory')(({ input }) =>
    WorkspaceFolderRuntime.use(runtime =>
      Effect.tryPromise({
        try: effectSignal => {
          effectSignal.throwIfAborted()
          return runtime.browse.createDirectory(input.path, input.name)
        },
        catch: error =>
          error instanceof DirectoryPickerError && error.code === 'directory-exists'
            ? new DirectoryAlreadyExists({ message: 'A folder with that name already exists.' })
            : new DirectoryCreateFailed({ message: 'Could not create this folder.' }),
      }),
    ),
  ),
})

const lifecycleApi = hostApi(projectLifecycleApi, {
  tools: Effect.fn('project tools status')(() =>
    WorkspaceFolderRuntime.use(runtime =>
      Effect.tryPromise({
        try: async () => {
          const [git, jj, gh] = await Promise.all((['git', 'jj', 'gh'] as const).map(command => runtime.deps.resolve(command)))
          return { home: homedir(), git: git !== undefined, jj: jj !== undefined, gh: gh !== undefined }
        },
        catch: toProjectLifecycleFailure,
      }),
    ),
  ),
  startClone: Effect.fn('project clone start')(({ input }) =>
    WorkspaceFolderRuntime.use(runtime => Effect.tryPromise({ try: () => runtime.cloneJobs.start(input), catch: toProjectLifecycleFailure })),
  ),
  cloneJobs: Effect.fn('project clone jobs list')(() => WorkspaceFolderRuntime.use(runtime => Effect.succeed({ jobs: runtime.cloneJobs.list() }))),
  cancelClone: Effect.fn('project clone cancel')(({ input }) =>
    WorkspaceFolderRuntime.use(runtime =>
      Effect.tryPromise({ try: () => Promise.resolve(runtime.cloneJobs.cancel(input.jobId)), catch: toProjectLifecycleFailure }),
    ),
  ),
  createProject: Effect.fn('project create request')(({ input }) =>
    WorkspaceFolderRuntime.use(runtime => Effect.tryPromise({ try: signal => createProject(runtime.deps, input, signal), catch: toProjectLifecycleFailure })),
  ),
  removeProject: Effect.fn('project remove')(({ input }) =>
    WorkspaceFolderRuntime.use(runtime => Effect.tryPromise({ try: () => runtime.removeProject(input.workspaceId), catch: toProjectLifecycleFailure })),
  ),
})

export default defineHost({
  ...effectPlugin,
  name: 'dshfiles-workspace-folder-picker',
  inject: ['subprocess', 'workspaceController'],
  apis: [browserApi, lifecycleApi],
})
