import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Effect, Layer, Option } from 'effect'
import { workspaceFolderBrowserApi } from './directory-browser-api.js'
import { DirectoryBrowser, executableLookupLayer, ProjectRemover, projectRegistryLayer } from './host-edge-promise.js'
import { CloneJobs, ExecutableLookup, ProjectCommands, ProjectCreator, ProjectHome } from './project-lifecycle.js'
import { projectLifecycleApi } from './project-lifecycle-api.js'

const projectLayer = Layer.mergeAll(CloneJobs.layer, ProjectCreator.layer).pipe(
  Layer.provide(ProjectCommands.layer),
  Layer.provideMerge(Layer.mergeAll(executableLookupLayer, projectRegistryLayer, DshChildProcessSpawner.layer, nodeFileSystemLayer)),
)

const toolsStatus = Effect.fn('project tools status')(function* () {
  const lookup = yield* ExecutableLookup
  const [git, jj, gh] = yield* Effect.all([lookup.resolve('git'), lookup.resolve('jj'), lookup.resolve('gh')], { concurrency: 'unbounded' })
  return { home: yield* ProjectHome, git: Option.isSome(git), jj: Option.isSome(jj), gh: Option.isSome(gh) }
})

export default DshxPlugin.make({
  name: 'dshfiles-workspace-folder-picker',
  inject: ['subprocess', 'workspaceController'],
  layer: Layer.mergeAll(projectLayer, DirectoryBrowser.layer, ProjectRemover.layer),
  apis: [
    Api.bind(workspaceFolderBrowserApi, {
      list: input => DirectoryBrowser.use(browser => browser.list(input.path)),
      createDirectory: input => DirectoryBrowser.use(browser => browser.createDirectory(input)),
    }),
    Api.bind(projectLifecycleApi, {
      tools: toolsStatus,
      startClone: input => CloneJobs.use(jobs => jobs.start(input)),
      cloneJobs: () => CloneJobs.use(jobs => Effect.map(jobs.list, list => ({ jobs: list }))),
      cancelClone: input => CloneJobs.use(jobs => jobs.cancel(input.jobId)),
      createProject: input => ProjectCreator.use(creator => creator.create(input)),
      removeProject: input => ProjectRemover.use(remover => remover.remove(input.workspaceId)),
    }),
  ],
})
