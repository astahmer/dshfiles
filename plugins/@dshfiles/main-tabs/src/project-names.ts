import { WorkspacePaths, type ThreadDirectories } from '@dshfiles/thread-sidebar/thread-directories'
import type { ProjectChip } from '@dshfiles/thread-sidebar/project-colors'
import { useMemo } from 'react'

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

/** Project chip presentation shared by the standalone strip and the Workbench publication. */
export const useTabProjectChips = (
  setting: boolean | undefined,
  workspaces: readonly ProjectWorkspace[],
  threadDirectories: ThreadDirectories,
  displayNameOf: (path: string) => string | undefined,
  chipOf: (path: string) => ProjectChip,
) => {
  const showProjectName = setting ?? true
  const projectNames = useMemo(() => {
    if (!showProjectName) return undefined
    const paths = ProjectNames.pathsByWorkspaceId(workspaces, threadDirectories)
    return new Map([...paths].map(([workspaceId, path]) => [workspaceId, displayNameOf(path) ?? path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path] as const))
  }, [displayNameOf, showProjectName, threadDirectories, workspaces])
  // Workbench draws its own header, so publish the resolved paint, not the colour logic.
  const projectChips = useMemo(() => {
    if (!showProjectName) return undefined
    const paths = ProjectNames.pathsByWorkspaceId(workspaces, threadDirectories)
    return Object.fromEntries([...paths].map(([workspaceId, path]) => [workspaceId, chipOf(path)] as const))
  }, [chipOf, showProjectName, threadDirectories, workspaces])
  // The publication fingerprints its snapshot as JSON: reuse the record on unchanged renders, and do not publish a Map.
  const projectNameChips = useMemo(() => (projectNames === undefined ? undefined : Object.fromEntries(projectNames)), [projectNames])
  return { projectNames, projectNameChips, projectChips }
}
