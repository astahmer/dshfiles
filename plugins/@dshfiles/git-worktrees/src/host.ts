import { defineApi, method } from '@dshfiles/dshx/api'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, Layer, Path, Schema } from 'effect'
import { GitWorktrees } from './git-worktrees.js'
import { gitWorktreesSettings } from './settings.js'
import { WorkspaceRegistry } from './workspace-registry-promise.js'

class WorkspaceNotFound extends Schema.TaggedError<WorkspaceNotFound>()(
  'WorkspaceNotFound',
  { workspaceId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'workspace-not-found' },
) {
  override get message(): string {
    return `Unknown workspace ${this.workspaceId}; refresh and retry.`
  }
}

const worktreeSchema = Schema.Struct({ name: Schema.String, path: Schema.String, branch: Schema.NullOr(Schema.String) })
const pathInputSchema = Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)) })
const worktreesOutputSchema = Schema.Struct({ worktrees: Schema.Array(worktreeSchema) })
const removeInputSchema = Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)), force: Schema.Boolean })
const removedOutputSchema = Schema.Struct({ removed: Schema.Literal(true) })

const gitWorktreesApi = defineApi({
  id: 'git-worktrees',
  version: 1,
  owner: '@dshfiles/git-worktrees',
  methods: {
    worktrees: method({
      input: pathInputSchema,
      output: worktreesOutputSchema,
      description: 'List the thread worktrees this plugin created for the git repository holding a path. Read-only.',
      tool: {
        name: 'git_thread_worktrees',
        readOnly: true,
        render: output =>
          output.worktrees.map(worktree => `${worktree.name} · ${worktree.path}${worktree.branch === null ? '' : ` · ${worktree.branch}`}`).join('\n') ||
          'No thread worktrees.',
      },
    }),
    remove: method({
      input: removeInputSchema,
      output: removedOutputSchema,
      description:
        'Remove one thread worktree with `git worktree remove` and drop its DSH project registration; its `dsh/thread-…` branch stays. With force false git refuses a worktree holding uncommitted changes; pass force true only when the user explicitly agreed to lose them. Call only when the user asked to remove that worktree.',
      tool: { name: 'git_thread_worktree_remove', render: () => 'Removed that thread worktree; its branch is kept.' },
    }),
  },
})

const provision = Effect.fn('git workspace provision')(function* (input: {
  readonly workspaceId: string
  readonly base?: string | undefined
  readonly isolate?: boolean | undefined
}) {
  const worktrees = yield* GitWorktrees
  const registry = yield* WorkspaceRegistry
  const path = yield* Path.Path
  const source = yield* registry.get(input.workspaceId)
  if (source === undefined) return yield* new WorkspaceNotFound({ workspaceId: input.workspaceId })
  const location = yield* worktrees.locate(source.path)
  if (location === undefined || !(yield* worktrees.isolateByDefault) || input.isolate === false) return { workspaceId: source.id, isolated: false }
  const project = yield* registry.resolveByPath(location.repoRoot)
  const thread = yield* worktrees.provision(location.repoRoot, input.base)
  const workspace = yield* registry.create(thread.path, `${project?.title ?? path.basename(location.repoRoot)} · ${thread.name}`)
  return { workspaceId: workspace.id, isolated: true }
})

const removeWorktree = Effect.fn('git worktree remove')(function* (input: { readonly path: string; readonly force: boolean }) {
  const worktrees = yield* GitWorktrees
  const registry = yield* WorkspaceRegistry
  const registered = yield* registry.resolveByPath(input.path)
  yield* worktrees.remove(input.path, input.force)
  if (registered !== undefined) yield* registry.delete(registered.id)
  return { removed: true as const }
})

const platform = Layer.mergeAll(DshChildProcessSpawner.layer, nodeFileSystemLayer, nodePathLayer, Settings.layer(gitWorktreesSettings))

export default DshxPlugin.make({
  name: '@dshfiles/git-worktrees',
  settings: [gitWorktreesSettings],
  layer: Layer.mergeAll(GitWorktrees.layer, WorkspaceRegistry.layer).pipe(Layer.provideMerge(platform)),
  apis: [
    Api.bind(gitWorktreesApi, {
      worktrees: input =>
        GitWorktrees.use(worktrees =>
          Effect.gen(function* () {
            const location = yield* worktrees.locate(input.path)
            return { worktrees: location === undefined ? [] : [...(yield* worktrees.worktrees(location.repoRoot))] }
          }),
        ),
      remove: removeWorktree,
    }),
    Api.bind(VcsProviders.contract('@dshfiles/git-worktrees'), {
      detect: input =>
        GitWorktrees.use(worktrees =>
          Effect.map(worktrees.locate(input.path), location =>
            location === undefined
              ? { match: null }
              : {
                  match: {
                    vcs: 'git',
                    priority: 10,
                    repoRoot: location.repoRoot,
                    workspaceRoot: location.workspaceRoot,
                    isolated: location.threadName !== undefined,
                  },
                },
          ),
        ),
      provision,
      snapshot: input => GitWorktrees.use(worktrees => Effect.map(worktrees.snapshot(input.path), snapshot => ({ snapshot }))),
      restore: input => GitWorktrees.use(worktrees => Effect.map(worktrees.restore(input.path, input.snapshot), previous => ({ previous }))),
    }),
  ],
})
