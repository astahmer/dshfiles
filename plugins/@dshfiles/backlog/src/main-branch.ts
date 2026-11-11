import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Jj } from '@dshfiles/jj-cli'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { Context, Effect, Layer, Ref } from 'effect'

/** The exact revset of one bookmark: quoted, so a name with `.` or `/` stays a name and an absent one is empty. */
const bookmarkRevset = (name: string): string => `bookmarks(exact:${JSON.stringify(name)})`

/** The bookmark's revset when it names a revision in `repository`; an absent bookmark would match nothing, silently. */
const resolvedRevset = Effect.fn('backlog main branch resolve')(function* (input: { readonly repository: string; readonly bookmark: string }) {
  const revset = bookmarkRevset(input.bookmark)
  const head = yield* (yield* Jj)
    .exec({
      cwd: input.repository,
      args: ['--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'commit_id'],
      timeout: '20 seconds',
      maxStdoutBytes: 4_000,
    })
    .pipe(
      Effect.map(output => output.stdout.trim()),
      Effect.orElseSucceed(() => ''),
    )
  return head === '' ? undefined : revset
})

/**
 * Where a repository's work lands: its project's main branch (Settings › Projects, `dsh.project.json` or origin's
 * default branch, as jj-integration resolves it), else `main`. `Closes b:12` and revision gates count only what reached it.
 */
export class BacklogMainBranch extends Context.Service<BacklogMainBranch, { readonly revsetFor: (repository: string) => Effect.Effect<string | undefined> }>()(
  '@dshfiles/backlog/BacklogMainBranch',
) {
  static readonly bookmarkRevset = bookmarkRevset
  static readonly resolvedRevset = resolvedRevset

  static readonly layer = Layer.effect(
    BacklogMainBranch,
    Effect.gen(function* () {
      const jjThreads = (yield* HostApis).client(jjIntegrationApi)
      const jj = yield* Jj
      const reported = yield* Ref.make<ReadonlySet<string>>(new Set())
      /** Polled every minute, so each missing branch is reported once per Host run. */
      const reportMissing = Effect.fnUntraced(function* (repository: string, bookmark: string) {
        const key = `${repository}\0${bookmark}`
        if ((yield* Ref.get(reported)).has(key)) return
        yield* Ref.update(reported, current => new Set([...current, key]))
        yield* Effect.logWarning(
          `backlog: ${repository} has no "${bookmark}" bookmark, so "Closes b:…" and revision gates cannot finish items there. Choose its main branch in Settings › Projects or create the bookmark.`,
        )
      })
      return BacklogMainBranch.of({
        revsetFor: repository =>
          jjThreads.projectBookmark({ path: repository }).pipe(
            Effect.map(resolved => resolved.bookmark),
            Effect.catch(error =>
              error.kind === 'unavailable'
                ? Effect.succeed('main')
                : Effect.as(Effect.logDebug(`backlog: no project main branch for ${repository}; reading main: ${error.message}`), 'main'),
            ),
            Effect.flatMap(bookmark =>
              resolvedRevset({ repository, bookmark }).pipe(
                Effect.provideService(Jj, jj),
                Effect.tap(revset => (revset === undefined ? reportMissing(repository, bookmark) : Effect.void)),
              ),
            ),
          ),
      })
    }),
  )

  /** Every repository lands on `main`: tests and profiles without jj-integration. */
  static readonly main = Layer.succeed(BacklogMainBranch, BacklogMainBranch.of({ revsetFor: () => Effect.succeed(bookmarkRevset('main')) }))
}
