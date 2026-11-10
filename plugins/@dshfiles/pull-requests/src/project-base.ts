import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { Context, Effect, Layer } from 'effect'

/**
 * The base a pull request targets when the project names its own main branch: chosen in Settings › Projects or
 * declared in `dsh.project.json` (jj-integration resolves both). Otherwise none, and the GitHub default branch applies,
 * since origin's default branch is the same branch and the global fallback is only a guess.
 */
export class ProjectBase extends Context.Service<
  ProjectBase,
  {
    readonly chosenFor: (cwd: string) => Effect.Effect<string | undefined>
  }
>()('@dshfiles/pull-requests/ProjectBase') {
  static readonly layer = Layer.effect(
    ProjectBase,
    Effect.gen(function* () {
      const jjThreads = (yield* HostApis).client(jjIntegrationApi)
      return ProjectBase.of({
        chosenFor: cwd =>
          jjThreads.projectBookmark({ path: cwd }).pipe(
            Effect.map(resolved => (resolved.source === 'project' || resolved.source === 'file' ? resolved.bookmark : undefined)),
            // Without jj-integration there is no project choice; any other failure also leaves the GitHub default branch.
            Effect.catch(error =>
              isApiOwnerMissing(error)
                ? Effect.succeed(undefined)
                : Effect.as(Effect.logDebug(`pull-requests: no project main branch for ${cwd}; using the GitHub default branch: ${error.message}`), undefined),
            ),
          ),
      })
    }),
  )

  /** No project choice: every pull request targets the GitHub default branch. */
  static readonly none = Layer.succeed(ProjectBase, ProjectBase.of({ chosenFor: () => Effect.succeed(undefined) }))
}
