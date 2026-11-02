import type {} from '@deepseek-ai/dsh-workspace'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Schema } from 'effect'

export class WorkspaceRegistryMissing extends Schema.TaggedError<WorkspaceRegistryMissing>()(
  'WorkspaceRegistryMissing',
  { cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'registry-missing' },
) {
  override get message(): string {
    return 'The DSH workspace registry is unavailable; restart DSH and retry.'
  }
}

export class WorkspaceRegistryFailed extends Schema.TaggedError<WorkspaceRegistryFailed>()(
  'WorkspaceRegistryFailed',
  { operation: Schema.Literals(['resolve', 'create', 'delete']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'workspace-registry-failed' },
) {
  override get message(): string {
    return `The DSH workspace registry could not ${this.operation} a project; refresh the project list and retry.`
  }
}

interface RegisteredWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
}

type RegistryError = WorkspaceRegistryMissing | WorkspaceRegistryFailed

/** The Host's Promise workspace registry, read per call: it is not injected, and an older Host may lack it. */
export class WorkspaceRegistry extends Context.Service<
  WorkspaceRegistry,
  {
    readonly get: (workspaceId: string) => Effect.Effect<RegisteredWorkspace | undefined, WorkspaceRegistryMissing>
    readonly resolveByPath: (path: string) => Effect.Effect<RegisteredWorkspace | undefined, RegistryError>
    readonly create: (path: string, title: string) => Effect.Effect<RegisteredWorkspace, RegistryError>
    readonly delete: (workspaceId: string) => Effect.Effect<void, RegistryError>
  }
>()('@dshfiles/git-worktrees/WorkspaceRegistry') {
  static readonly layer = Layer.effect(
    WorkspaceRegistry,
    Effect.gen(function* () {
      const host = yield* HostContext
      const registry = Effect.suspend(() => {
        const found = host.ctx.get('workspaceRegistry')
        return found === undefined ? Effect.fail(new WorkspaceRegistryMissing({})) : Effect.succeed(found)
      })
      const call = <A>(operation: WorkspaceRegistryFailed['operation'], run: (found: Effect.Success<typeof registry>) => Promise<A>) =>
        Effect.flatMap(registry, found => Effect.tryPromise({ try: () => run(found), catch: cause => new WorkspaceRegistryFailed({ operation, cause }) }))
      return WorkspaceRegistry.of({
        get: workspaceId => Effect.map(registry, found => found.get(WorkspaceId(workspaceId))),
        resolveByPath: path => call('resolve', found => found.resolveByPath(path)),
        create: (path, title) => call('create', found => found.create(path, title)),
        delete: workspaceId => Effect.asVoid(call('delete', found => found.delete(WorkspaceId(workspaceId)))),
      })
    }),
  )
}
