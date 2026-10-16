export interface RegisteredProjectSource {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

export const registeredProjects = async (input: {
  readonly workspaces: readonly RegisteredProjectSource[]
  readonly isSecondaryWorkspace: (path: string) => Promise<boolean>
}): Promise<readonly RegisteredProjectSource[]> => {
  const projects = await Promise.all(
    input.workspaces.map(async workspace => {
      if (await input.isSecondaryWorkspace(workspace.path)) return null
      return workspace
    }),
  )
  return projects.filter(project => project !== null)
}
