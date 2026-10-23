export const threadAtQueryKey = (path: string, sessionId?: string) =>
  sessionId === undefined ? (['jj-integration', 'thread', path] as const) : (['jj-integration', 'thread', path, sessionId] as const)
