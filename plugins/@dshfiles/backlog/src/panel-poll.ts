/**
 * A Backlog panel stays mounted while another main panel is shown, so its polls only run while it is visible.
 * The revision read notices any write, and the AI-activity read drives the working indicator.
 */
const REVISION_POLL_MS = 5_000
const AI_ACTIVITY_POLL_MS = 1_000

const revisionPollMs = (input: { readonly visible: boolean }): number | false => (input.visible ? REVISION_POLL_MS : false)

const aiActivityPollMs = (input: { readonly visible: boolean; readonly failed: boolean }): number | false =>
  input.visible && !input.failed ? AI_ACTIVITY_POLL_MS : false

/** Hidden → visible: the polls were paused, so read both once instead of waiting for the next tick. */
const shouldRefreshOnReveal = (input: { readonly wasVisible: boolean | undefined; readonly visible: boolean }): boolean =>
  input.wasVisible === false && input.visible

export class BacklogPanelPoll {
  static readonly revisionMs = revisionPollMs
  static readonly aiActivityMs = aiActivityPollMs
  static readonly shouldRefreshOnReveal = shouldRefreshOnReveal
}
