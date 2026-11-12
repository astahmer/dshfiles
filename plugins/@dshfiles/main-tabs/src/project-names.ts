import { WorkspacePaths, type ThreadDirectories } from '@dshfiles/thread-sidebar/thread-directories'

interface ProjectWorkspace {
  readonly workspaceId: string
  readonly path: string
}

/**
 * Each workspace's project folder name, keyed by workspace id, for labels in front of thread titles. A thread workspace
 * (`<repository>-threads/<name>`, or a provider-reported threads directory) carries its project's name, never its own
 * folder: thread-sidebar names the thread first and the project second, and a tab says the same.
 */
const byWorkspaceId = (workspaces: readonly ProjectWorkspace[], threadDirectories?: ThreadDirectories): ReadonlyMap<string, string> =>
  new Map(
    workspaces.flatMap(workspace => {
      const name = WorkspacePaths.projectPathOf({ path: workspace.path, threadDirectories }).split(/[\\/]/).filter(Boolean).at(-1)
      return name === undefined ? [] : [[workspace.workspaceId, name] as const]
    }),
  )

export class ProjectNames {
  static readonly byWorkspaceId = byWorkspaceId
}
