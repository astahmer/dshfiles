import type { ThreadAttentionSnapshot } from '@dshfiles/thread-sidebar/attention-api'

/** An explicit tab selection clears only the attention version the browser rendered. */
export const clearTabAttention = async (
  sessionId: string,
  snapshot: ThreadAttentionSnapshot | undefined,
  clearUnread: (input: { sessionId: string; version: number }) => Promise<ThreadAttentionSnapshot>,
  refresh: () => void,
): Promise<void> => {
  const record = snapshot?.sessions.find(candidate => candidate.sessionId === sessionId)
  if (record === undefined) return
  await clearUnread({ sessionId, version: record.version })
  refresh()
}
