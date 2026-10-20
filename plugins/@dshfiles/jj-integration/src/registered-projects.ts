export interface RegisteredProjectSource {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

export type RegisteredWorkspaceKind = 'project' | 'workspace' | 'missing'

/**
 * Splits registered workspaces into real checkouts and thread workspaces. A folder that no longer exists is neither:
 * a removed thread workspace keeps its registration, and counting it as a project flooded the picker.
 */
export const registeredProjects = async (input: {
  readonly workspaces: readonly RegisteredProjectSource[]
  readonly classify: (path: string) => Promise<RegisteredWorkspaceKind>
}): Promise<{ readonly projects: readonly RegisteredProjectSource[]; readonly workspaces: readonly RegisteredProjectSource[] }> => {
  const kinds = await Promise.all(input.workspaces.map(workspace => input.classify(workspace.path)))
  return {
    projects: input.workspaces.filter((_, index) => kinds[index] === 'project'),
    workspaces: input.workspaces.filter((_, index) => kinds[index] === 'workspace'),
  }
}
