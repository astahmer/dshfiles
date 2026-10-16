export interface NewThreadWorkspaceReference {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

export const resolveNewThreadWorkspaceId = (input: {
  readonly selectedWorkspaceId: string | undefined
  readonly sessionId: string
  readonly sessionCwd: string | undefined
  readonly workspaces: readonly NewThreadWorkspaceReference[]
}): string | undefined => {
  if (input.selectedWorkspaceId !== undefined) return input.selectedWorkspaceId
  const sessionWorkspace = input.workspaces.find(workspace => workspace.sessionIds.includes(input.sessionId))
  if (sessionWorkspace !== undefined) return sessionWorkspace.workspaceId
  return input.workspaces.find(workspace => workspace.path === input.sessionCwd)?.workspaceId
}
