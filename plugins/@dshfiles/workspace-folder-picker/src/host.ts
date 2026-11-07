import type {} from '@deepseek-ai/dsh-host-directory-picker'
import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, FileSystem, Layer, Option, Path } from 'effect'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'
import { FolderInspector } from './folder-inspection.js'
import { DirectoryBrowser, executableLookupLayer, ProjectRemover, projectRegistryLayer } from './host-edge-promise.js'
import { CloneJobs, ExecutableLookup, ProjectCommands, ProjectCreator, ProjectHome } from './project-lifecycle.js'
import { Clock } from 'effect'
import { ProjectIcon } from './project-icon.js'
import { loadProjectConfig } from './project-config.js'
import { projectLifecycleApi } from './project-lifecycle-api.js'
import { registeredProjects } from './registered-projects.js'

const projectLayer = Layer.mergeAll(CloneJobs.layer, ProjectCreator.layer, FolderInspector.layer).pipe(
  Layer.provide(ProjectCommands.layer),
  Layer.provideMerge(Layer.mergeAll(executableLookupLayer, projectRegistryLayer, DshChildProcessSpawner.layer, nodeFileSystemLayer, nodePathLayer)),
)

const toolsStatus = Effect.fn('project tools status')(function* () {
  const lookup = yield* ExecutableLookup
  const [git, jj, gh] = yield* Effect.all([lookup.resolve('git'), lookup.resolve('jj'), lookup.resolve('gh')], { concurrency: 'unbounded' })
  return { home: yield* ProjectHome, git: Option.isSome(git), jj: Option.isSome(jj), gh: Option.isSome(gh) }
})

/** Read per call: the Host's picker is optional and may come or go, and a browse-only one cannot open a native dialog. */
const pickerCapabilities = Effect.fn('directory picker read capability')(function* () {
  const picker = yield* hostService('directoryPicker').pipe(Effect.option)
  return {
    nativePicker: Option.isSome(picker) && picker.value.capability().kind === 'native',
    pathStyle: process.platform === 'win32' ? ('windows' as const) : ('posix' as const),
  }
})

export default DshxPlugin.make({
  name: 'dshfiles-workspace-folder-picker',
  inject: ['subprocess', 'workspaceController', 'workspaceRegistry'],
  layer: Layer.mergeAll(projectLayer, DirectoryBrowser.layer, ProjectRemover.layer),
  apis: [
    Api.bind(workspaceFolderBrowserApi, {
      capabilities: pickerCapabilities,
      list: input => DirectoryBrowser.use(browser => browser.list(input.path)),
      createDirectory: input => DirectoryBrowser.use(browser => browser.createDirectory(input)),
    }),
    Api.bind(projectLifecycleApi, {
      tools: toolsStatus,
      startClone: input => CloneJobs.use(jobs => jobs.start(input)),
      cloneJobs: () => CloneJobs.use(jobs => Effect.map(jobs.list, list => ({ jobs: list }))),
      cancelClone: input => CloneJobs.use(jobs => jobs.cancel(input.jobId)),
      retryClone: input => CloneJobs.use(jobs => jobs.retry(input.jobId)),
      createProject: input => ProjectCreator.use(creator => creator.create(input)),
      inspect: input => FolderInspector.use(inspector => inspector.inspect(input.path)),
      initProject: input => ProjectCreator.use(creator => creator.initialize(input)),
      publishProject: input => ProjectCreator.use(creator => creator.publish(input)),
      projects: () =>
        Effect.map(hostService('workspaceRegistry'), registry => ({
          projects: registeredProjects(registry.list().map(workspace => ({ workspaceId: String(workspace.id), title: workspace.title, path: workspace.path }))),
        })),
      projectIdentities: input =>
        Effect.gen(function* () {
          const inspector = yield* FolderInspector
          const identities = yield* Effect.forEach(
            input.paths,
            path =>
              inspector.inspect(path).pipe(
                Effect.map(inspection => ({
                  path,
                  key: inspection.remoteUrl ?? inspection.repositoryRoot ?? inspection.path,
                  remoteUrl: inspection.remoteUrl,
                  repositoryRoot: inspection.repositoryRoot,
                })),
                Effect.catch(() => Effect.succeed({ path, key: path, remoteUrl: null, repositoryRoot: null })),
              ),
            { concurrency: 4 },
          )
          return { identities }
        }),
      icon: input =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const path = yield* Path.Path
          const now = yield* Clock.currentTimeMillis
          const icons = yield* ProjectIcon.cache({ fs, path })
          const title = input.title ?? path.basename(input.path)
          return yield* icons.read({ workspaceRoot: input.path, title, now })
        }),
      readProjectConfig: input =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          return { path: input.path, ...(yield* loadProjectConfig(fs, input.path)) }
        }),
      removeProject: input => ProjectRemover.use(remover => remover.remove(input.workspaceId)),
    }),
  ],
})
