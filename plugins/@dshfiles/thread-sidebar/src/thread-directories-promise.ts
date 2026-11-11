import type { Context as CordisContext } from '@deepseek-ai/cordis'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { Effect } from 'effect'
import { WorkspacePaths } from './workspace-paths.js'

const MAX_REPO_ROOTS = 1000

/**
 * The thread directories every VCS provider reports for these project checkouts. A Host without a provider, or one
 * whose providers fail, answers none, so attribution keeps the `<repository>-threads` layout.
 */
export const loadThreadDirectories = Effect.fn('thread directories load')(function* (input: {
  readonly ctx: CordisContext
  readonly packageId: string
  readonly projectPaths: readonly string[]
}) {
  const repoRoots = [...new Set(input.projectPaths)].slice(0, MAX_REPO_ROOTS)
  yield* Effect.annotateCurrentSpan({ repoRoots: repoRoots.length })
  const reported = yield* Effect.tryPromise(signal => VcsProviders.threadsDirectories(input.ctx, { repoRoots, callerPackageId: input.packageId, signal })).pipe(
    Effect.orElseSucceed(() => []),
  )
  return WorkspacePaths.threadDirectoriesOf(reported)
})
