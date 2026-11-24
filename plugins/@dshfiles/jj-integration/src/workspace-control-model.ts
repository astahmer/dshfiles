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

/**
 * The last folders of a workspace path, for a label: an absolute path cut at its end hides the one part that tells
 * workspaces apart (`/private/var/folders/3k/k0xz2zs…`). The full path stays in the tooltip and behind Copy path.
 */
const pathTail = (path: string, segments = 2): string => {
  const parts = path.split(/[\\/]/u).filter(part => part.length > 0)
  if (parts.length <= segments) return path
  return parts.slice(-segments).join(path.includes('\\') && !path.includes('/') ? '\\' : '/')
}

/**
 * Which seat draws the header Land. A desktop header puts it beside the workspace chip. A phone folds the header
 * utilities (the chip included) into the ⋯ sheet, so the top bar's own seat carries it there and the sheet does not:
 * one Land on screen, opening the same confirmation.
 */
const landSeatShows = (input: { readonly seat: 'header' | 'phone-bar'; readonly phone: boolean }): boolean => (input.seat === 'phone-bar') === input.phone

export class WorkspaceControlModel {
  static readonly showsLand = showsLand
  static readonly landSeatShows = landSeatShows
  static readonly pathTail = pathTail
}
