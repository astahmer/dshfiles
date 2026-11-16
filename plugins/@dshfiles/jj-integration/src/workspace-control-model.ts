/** What the thread header's workspace control shows, decided apart from the component so each rule has a test. */

interface LandFacts {
  /** The Session works in a thread workspace; false in the project checkout. */
  readonly isThread: boolean
  readonly unlanded: readonly { readonly description: string; readonly conflict: boolean }[]
  /** Every thread in the workspace is idle and no question waits, as far as this client can tell. */
  readonly canLand: boolean
  /** A land is already queued for when the workspace is idle. */
  readonly queued: boolean
}

/**
 * Whether the header carries its one primary verb, Land. Only while there is work to land and landing can start now:
 * conflicts, a revision without a description, a busy thread or a queued land all leave the header without the button,
 * and the workspace menu says why. A fixed surface shows a verb only while it carries live state (DESIGN.md).
 */
const showsLand = (facts: LandFacts): boolean =>
  facts.isThread &&
  facts.unlanded.length > 0 &&
  facts.canLand &&
  !facts.queued &&
  facts.unlanded.every(revision => !revision.conflict && revision.description.trim().length > 0)

export class WorkspaceControlModel {
  static readonly showsLand = showsLand
}
