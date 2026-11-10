import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { Context, Effect, Layer } from 'effect'

/** A branch name the review can try as a bare revision in both jj and git: revset and option syntax stay out. */
const PLAIN_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/u

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
            Effect.map(resolved => (resolved.source !== 'global' && PLAIN_BRANCH.test(resolved.bookmark) ? resolved.bookmark : undefined)),
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
