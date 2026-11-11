import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { jjIntegrationApi, projectMainBranch } from '@dshfiles/jj-integration/api'
import { Context, Effect, Layer } from 'effect'

/**
 * The base a review without one starts from: the project's main branch when it was chosen in Settings › Projects,
 * declared in `dsh.project.json` or detected as origin's default branch (jj-integration resolves all three). With only
 * the global fallback, or without jj-integration, none: the review keeps trying main, master and trunk.
 */
export class ProjectBase extends Context.Service<
  ProjectBase,
  {
    readonly defaultFor: (path: string) => Effect.Effect<string | undefined>
  }
>()('@dshfiles/pulls-review/ProjectBase') {
  static readonly layer = Layer.effect(
    ProjectBase,
    Effect.gen(function* () {
      const jjThreads = (yield* HostApis).client(jjIntegrationApi)
      return ProjectBase.of({
        defaultFor: path =>
          jjThreads.projectBookmark({ path }).pipe(
            Effect.map(resolved => projectMainBranch({ resolved, sources: ['project', 'file', 'detected'] })),
            Effect.catch(error =>
              isApiOwnerMissing(error)
                ? Effect.succeed(undefined)
                : Effect.as(Effect.logDebug(`pulls-review: no project main branch for ${path}; trying main, master and trunk: ${error.message}`), undefined),
            ),
          ),
      })
    }),
  )
}
