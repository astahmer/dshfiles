interface SessionPathView {
  readonly cwd?: string | undefined
  readonly parentId?: string | undefined
}

interface WorkspacePathView {
  readonly path: string
  readonly sessionIds: readonly string[]
}

export const sessionProjectPath = (
  sessionId: string,
  sessions: Readonly<Record<string, SessionPathView>>,
  workspaces: readonly WorkspacePathView[],
): string | undefined => {
  const session = sessions[sessionId]
  if (session === undefined) return undefined

  const ownWorkspace = workspaces.find(workspace => workspace.sessionIds.includes(sessionId))
  if (ownWorkspace !== undefined) return ownWorkspace.path

  const visited = new Set([sessionId])
  let parentId = session.parentId
  while (parentId !== undefined && !visited.has(parentId)) {
    // Snapshot the ancestor for the callback before advancing the mutable parent cursor.
    // oxlint-disable-next-line antislop/no-passthrough-variable
    const currentParentId = parentId
    visited.add(currentParentId)
    const parentWorkspace = workspaces.find(workspace => workspace.sessionIds.includes(currentParentId))
    if (parentWorkspace !== undefined) return parentWorkspace.path
    parentId = sessions[currentParentId]?.parentId
  }

  return session.cwd
}
