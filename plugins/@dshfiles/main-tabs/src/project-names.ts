import { WorkspacePaths, type ThreadDirectories } from '@dshfiles/thread-sidebar/thread-directories'

interface ProjectWorkspace {
  readonly workspaceId: string
  readonly path: string
}

/** The project folder behind a workspace: a thread workspace names its project, never its own folder. */
const projectPathOf = (workspace: ProjectWorkspace, threadDirectories?: ThreadDirectories): string =>
  WorkspacePaths.projectPathOf({ path: workspace.path, threadDirectories })

/**
 * Each workspace's project folder name, keyed by workspace id, for labels in front of thread titles. A thread workspace
 * (`<repository>-threads/<name>`, or a provider-reported threads directory) carries its project's name, never its own
 * folder: thread-sidebar names the thread first and the project second, and a tab says the same.
 */
const byWorkspaceId = (workspaces: readonly ProjectWorkspace[], threadDirectories?: ThreadDirectories): ReadonlyMap<string, string> =>
  new Map(
    workspaces.flatMap(workspace => {
      const name = projectPathOf(workspace, threadDirectories).split(/[\\/]/).filter(Boolean).at(-1)
      return name === undefined ? [] : [[workspace.workspaceId, name] as const]
    }),
  )

/** The absolute project folder per workspace id, so a project's chosen colour can be resolved for its tabs. */
const pathsByWorkspaceId = (workspaces: readonly ProjectWorkspace[], threadDirectories?: ThreadDirectories): ReadonlyMap<string, string> =>
  new Map(workspaces.map(workspace => [workspace.workspaceId, projectPathOf(workspace, threadDirectories)] as const))

export class ProjectNames {
  static readonly byWorkspaceId = byWorkspaceId
  static readonly pathsByWorkspaceId = pathsByWorkspaceId
}
