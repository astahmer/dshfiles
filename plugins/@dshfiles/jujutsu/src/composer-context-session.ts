export const composerSessionCwd = (
  sessionId: string,
  sessionCwd: string | undefined,
  workspaces: readonly { readonly path: string; readonly sessionIds: readonly string[] }[],
): string | null => workspaces.find(workspace => workspace.sessionIds.includes(sessionId))?.path ?? sessionCwd ?? null
