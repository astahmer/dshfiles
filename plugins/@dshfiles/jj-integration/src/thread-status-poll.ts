/**
 * A thread's Host-side workspace status changes when this browser lands or a
 * queued integration finishes, and every mutation invalidates the query
 * directly. The idle poll is only a cross-process safety net, so it can be slow;
 * a queued integration is the one state that resolves without a local mutation.
 *
 * Work landed or rebased outside this browser (a jj command in a terminal, an
 * agent's own rebase) has no local mutation either. The open workspace menu is
 * where the user reads that status, so it refreshes when it opens and polls
 * fast while it stays open, instead of showing a count up to a minute old.
 */
const IDLE_POLL_MS = 60_000
const MENU_OPEN_POLL_MS = 3_000
const QUEUED_POLL_MS = 2_000

export const threadStatusPollMs = (input: { readonly hasThread: boolean; readonly queued: boolean; readonly menuOpen?: boolean }): number | false => {
  if (!input.hasThread) return false
  if (input.queued) return QUEUED_POLL_MS
  return input.menuOpen === true ? MENU_OPEN_POLL_MS : IDLE_POLL_MS
}
