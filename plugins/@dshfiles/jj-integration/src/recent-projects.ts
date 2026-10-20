import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'

export interface RecentThread {
  readonly cwd: string | null | undefined
  readonly updatedAt: number
  readonly blank: boolean
}

/** Paths of the projects the latest threads ran in, newest first and each once; a thread workspace counts as its project. */
export const recentProjectPaths = (input: {
  readonly threads: readonly RecentThread[]
  readonly projectPaths: readonly string[]
  readonly limit: number
}): readonly string[] => {
  const projects = new Set(input.projectPaths)
  const recent = new Set<string>()
  for (const thread of [...input.threads].sort((left, right) => right.updatedAt - left.updatedAt)) {
    if (recent.size >= input.limit) break
    if (thread.blank || thread.cwd === null || thread.cwd === undefined) continue
    const repository = EntityLabels.repositoryPath(thread.cwd)
    if (projects.has(repository)) recent.add(repository)
  }
  return [...recent]
}
