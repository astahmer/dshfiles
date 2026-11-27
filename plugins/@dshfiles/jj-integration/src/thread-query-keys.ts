export const threadAtQueryKey = (path: string, sessionId?: string) =>
  sessionId === undefined ? (['jj-integration', 'thread', path] as const) : (['jj-integration', 'thread', path, sessionId] as const)

/** Query keys of the Workspaces page, shared with the thread header and the entry, which stay at boot. */
export const threadQueryKeys = {
  repositories: ['jj-integration', 'repositories'] as const,
  threadAt: threadAtQueryKey,
  workspaceSync: ['jj-integration', 'workspace-sync'] as const,
}
