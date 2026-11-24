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

/** What the header knows about the thread's lands: the land time it last read, and whether it says Landed. */
export interface LandedMark {
  readonly sessionId: string
  /** `null` until the first status read; `undefined` when the thread never landed. */
  readonly seenRebasedAt: number | undefined | null
  readonly shown: boolean
}

const initialLandedMark = (sessionId: string): LandedMark => ({ sessionId, seenRebasedAt: null, shown: false })

/**
 * Round two item 19: a land the header saw finish (its own, or one the status read reveals) shows a green check and
 * "Landed" until the thread changes: new work to land, or another thread on screen. An older land read on first sight
 * is history, not a result to confirm.
 */
const landedMark = (
  previous: LandedMark,
  observed: { readonly sessionId: string; readonly rebasedAt: number | undefined; readonly unlanded: number; readonly landedHere?: boolean },
): LandedMark => {
  const base = previous.sessionId === observed.sessionId ? previous : initialLandedMark(observed.sessionId)
  const landedSince = base.seenRebasedAt !== null && observed.rebasedAt !== undefined && observed.rebasedAt !== base.seenRebasedAt
  const shown = observed.unlanded > 0 ? false : observed.landedHere === true || landedSince || base.shown
  return { sessionId: observed.sessionId, seenRebasedAt: observed.rebasedAt, shown }
}

/**
 * A status read that saw a land or a queue change since the previous one (a land in another view, `/rebase`, a queued
 * land finishing): the other views reading the inventory (the thread list's "N to land", the Land page) refetch now.
 */
const repositoryMoved = (
  previous: { readonly rebasedAt?: number | undefined; readonly integrationQueuedAt?: number | undefined } | null | undefined,
  current: { readonly rebasedAt?: number | undefined; readonly integrationQueuedAt?: number | undefined } | null | undefined,
): boolean =>
  previous !== undefined &&
  previous !== null &&
  (previous.rebasedAt !== current?.rebasedAt || previous.integrationQueuedAt !== current?.integrationQueuedAt)

export class WorkspaceControlModel {
  static readonly showsLand = showsLand
  static readonly landSeatShows = landSeatShows
  static readonly initialLandedMark = initialLandedMark
  static readonly landedMark = landedMark
  static readonly repositoryMoved = repositoryMoved
  static readonly pathTail = pathTail
}
