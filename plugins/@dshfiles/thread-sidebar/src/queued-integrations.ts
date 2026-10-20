export const indexQueuedIntegrationSessions = (
  threads: readonly { readonly sessionIds: readonly string[]; readonly integrationQueuedAt?: number | undefined }[],
): ReadonlyMap<string, number> => {
  const queuedAtBySessionId = new Map<string, number>()
  for (const thread of threads) {
    if (thread.integrationQueuedAt === undefined) continue
    for (const sessionId of thread.sessionIds) queuedAtBySessionId.set(sessionId, thread.integrationQueuedAt)
  }
  return queuedAtBySessionId
}
