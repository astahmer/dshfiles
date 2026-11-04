import { Effect } from 'effect'

export interface RepositoryBatchResult {
  readonly path: string
  readonly repoId: string | null
  readonly root: string | null
}

const DEFAULT_CONCURRENCY = 4

/**
 * Resolve folders to repositories without letting one non-repository directory fail the batch. A reference preview
 * asks about every known project at once; reporting per path turns that from N calls plus a failed call per non-repo
 * into one call whose failures are ordinary rows.
 */
export const registerRepositoryBatch = <E, R>(input: {
  readonly paths: readonly string[]
  readonly register: (path: string) => Effect.Effect<{ readonly repoId: string; readonly root: string }, E, R>
  readonly concurrency?: number
}): Effect.Effect<readonly RepositoryBatchResult[], never, R> =>
  Effect.forEach(
    [...new Set(input.paths)],
    path =>
      input.register(path).pipe(
        Effect.map((repository): RepositoryBatchResult => ({ path, repoId: repository.repoId, root: repository.root })),
        Effect.orElseSucceed((): RepositoryBatchResult => ({ path, repoId: null, root: null })),
      ),
    { concurrency: Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY) },
  )
