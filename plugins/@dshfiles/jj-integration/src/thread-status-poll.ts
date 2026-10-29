/**
 * A thread's Host-side workspace status changes when this browser lands or a
 * queued integration finishes, and every mutation invalidates the query
 * directly. The idle poll is only a cross-process safety net, so it can be slow;
 * a queued integration is the one state that resolves without a local mutation.
 */
const IDLE_POLL_MS = 60_000
const QUEUED_POLL_MS = 2_000

export const threadStatusPollMs = (input: { readonly hasThread: boolean; readonly queued: boolean }): number | false => {
  if (!input.hasThread) return false
  return input.queued ? QUEUED_POLL_MS : IDLE_POLL_MS
}
