import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { Context, Effect, Layer } from 'effect'

/** The exact revset of one bookmark: quoted, so a name with `.` or `/` stays a name and an absent one is empty. */
const bookmarkRevset = (name: string): string => `bookmarks(exact:${JSON.stringify(name)})`

/**
 * Where a repository's work lands: its project's main branch (Settings › Projects, `dsh.project.json` or origin's
 * default branch, as jj-integration resolves it), else `main`. `Closes b:12` and revision gates count only what reached it.
 */
export class BacklogMainBranch extends Context.Service<BacklogMainBranch, { readonly revsetFor: (repository: string) => Effect.Effect<string> }>()(
  '@dshfiles/backlog/BacklogMainBranch',
) {
  static readonly bookmarkRevset = bookmarkRevset

  static readonly layer = Layer.effect(
    BacklogMainBranch,
    Effect.gen(function* () {
      const jj = (yield* HostApis).client(jjIntegrationApi)
      return BacklogMainBranch.of({
        revsetFor: repository =>
          jj.projectBookmark({ path: repository }).pipe(
            Effect.map(resolved => resolved.bookmark),
            Effect.catch(error =>
              error.kind === 'unavailable'
                ? Effect.succeed('main')
                : Effect.as(Effect.logDebug(`backlog: no project main branch for ${repository}; reading main: ${error.message}`), 'main'),
            ),
            Effect.map(bookmarkRevset),
          ),
      })
    }),
  )

  /** Every repository lands on `main`: tests and profiles without jj-integration. */
  static readonly main = Layer.succeed(BacklogMainBranch, BacklogMainBranch.of({ revsetFor: () => Effect.succeed(bookmarkRevset('main')) }))
}
