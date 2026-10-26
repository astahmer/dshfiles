export interface RepositoryBatchResult {
  readonly path: string
  readonly repoId: string | null
  readonly root: string | null
}

const DEFAULT_CONCURRENCY = 4

/**
 * Resolve folders to repositories without letting one non-repository directory
 * fail the batch. A reference preview asks about every known project at once;
 * reporting per path turns that from N calls plus a failed call per non-repo
 * into one call whose failures are ordinary rows.
 */
export const registerRepositoryBatch = async (input: {
  readonly paths: readonly string[]
  readonly register: (path: string) => Promise<{ readonly repoId: string; readonly root: string }>
  readonly concurrency?: number
  readonly signal?: AbortSignal
}): Promise<readonly RepositoryBatchResult[]> => {
  const paths = [...new Set(input.paths)]
  const concurrency = Math.max(1, Math.min(input.concurrency ?? DEFAULT_CONCURRENCY, paths.length))
  const results: RepositoryBatchResult[] = []
  for (let start = 0; start < paths.length; start += concurrency) {
    const chunk = paths.slice(start, start + concurrency)
    const settled = await Promise.all(
      chunk.map(async (path): Promise<RepositoryBatchResult> => {
        try {
          const repository = await input.register(path)
          return { path, repoId: repository.repoId, root: repository.root }
        } catch (error) {
          if (input.signal?.aborted === true) throw error
          return { path, repoId: null, root: null }
        }
      }),
    )
    results.push(...settled)
  }
  return results
}
