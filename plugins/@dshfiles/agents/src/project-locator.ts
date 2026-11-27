import type {} from '@deepseek-ai/dsh-workspace'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { WorkspaceAttribution, WorkspacePaths, type AttributedWorkspace, type ThreadDirectories } from '@dshfiles/vcs-provider-port/workspace-attribution'
import { DshxPlugin, HostContext, hostService } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'

/** The project a Session belongs to, answered synchronously because a thread's agent is decided while it attaches. */
export class ProjectLocator extends Context.Service<
  ProjectLocator,
  {
    readonly projectOf: (session: { readonly sessionId: string; readonly cwd: string | undefined }) => string | undefined
  }
>()('@dshfiles/agents/ProjectLocator') {
  /**
   * The Host workspace registry, attributed with `@dshfiles/vcs-provider-port/workspace-attribution` (thread-sidebar's
   * rule). Custom thread folders come from the VCS providers, read in the background whenever the set of project
   * paths changes; until that read lands, the default `<repository>-threads` layout applies.
   */
  static readonly layer = Layer.effect(
    ProjectLocator,
    Effect.gen(function* () {
      const host = yield* HostContext
      const registry = yield* hostService('workspaceRegistry')
      let threadDirectories: ThreadDirectories = new Map()
      let readFor: string | undefined
      const read = yield* DshxPlugin.callback((repoRoots: readonly string[]) =>
        Effect.tryPromise(signal => VcsProviders.threadsDirectories(host.ctx, { repoRoots, callerPackageId: host.packageId, signal })).pipe(
          Effect.map(reported => {
            threadDirectories = WorkspacePaths.threadDirectoriesOf(reported)
          }),
          // Attribution keeps the default `<repository>-threads` layout when no provider answers.
          Effect.catch(error => Effect.logWarning('agents: VCS providers did not report thread directories', error)),
          Effect.withSpan('agents thread directories read', { attributes: { repoRoots: repoRoots.length } }),
        ),
      )
      const rows = (): AttributedWorkspace[] =>
        registry.list().map(workspace => ({ workspaceId: workspace.id, path: workspace.path, sessionIds: [...workspace.sessionIds] }))
      return ProjectLocator.of({
        projectOf: session => {
          const workspaces = rows()
          const projectPaths = WorkspacePaths.projects({ rows: workspaces })
            .map(workspace => workspace.path)
            .sort()
          const key = projectPaths.join('\n')
          if (key !== readFor) {
            readFor = key
            void read(projectPaths)
          }
          return WorkspaceAttribution.projectOfSession({ workspaces, sessionId: session.sessionId, cwd: session.cwd, threadDirectories })
        },
      })
    }),
  )

  /** Fixed workspaces, for tests. */
  static readonly layerTest = (workspaces: readonly AttributedWorkspace[]) =>
    Layer.succeed(
      ProjectLocator,
      ProjectLocator.of({ projectOf: session => WorkspaceAttribution.projectOfSession({ workspaces, sessionId: session.sessionId, cwd: session.cwd }) }),
    )
}
