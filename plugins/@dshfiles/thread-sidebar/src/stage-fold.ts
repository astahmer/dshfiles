/**
 * One navigation at a time (round five B1, B2). When the stage shows the page a destination's list would only repeat,
 * the left column folds to its rail: Settings, whose page draws its own category list, and a destination with a single
 * page (the Inbox, a 290 px column for one row). The rail keeps that destination's item active. When the page leaves
 * the stage, the column opens again, but only if this folded it: a column the person collapsed stays collapsed, and one
 * they opened by hand while the page shows stays open until the page leaves.
 *
 * The fold is the frame's own collapse (the frame persists it), so the "this folded it" marker is stored too: a reload
 * while Settings showed opens the column again instead of leaving it folded for good.
 */

export interface StageFoldState {
  /** The column is collapsed because the stage page asked for it. */
  readonly folded: boolean
  /** The person opened the column by hand while the page showed: do not fold it again until the page leaves. */
  readonly userOpened: boolean
}

export interface StageFoldInput {
  /** The stage shows a page the column's list would only repeat. */
  readonly wants: boolean
  /** The frame's left column is collapsed to the rail. */
  readonly collapsed: boolean
}

export interface StageFoldStep {
  readonly next: StageFoldState
  /** Flip the frame's column (collapse to fold, expand to unfold). */
  readonly toggle: boolean
}

const step = (state: StageFoldState, input: StageFoldInput): StageFoldStep => {
  // The page left the stage: open what this folded, and forget a hand-opened column.
  if (!input.wants) return { next: { folded: false, userOpened: false }, toggle: state.folded && input.collapsed }
  if (state.folded) return input.collapsed ? { next: state, toggle: false } : { next: { folded: false, userOpened: true }, toggle: false }
  // Already collapsed by the person, or opened by them while this page shows: leave it.
  if (input.collapsed || state.userOpened) return { next: state, toggle: false }
  return { next: { folded: true, userOpened: false }, toggle: true }
}

/** The page on the stage and the folder whose list the column shows: does the list only repeat the page? */
const wants = (input: {
  readonly folderId: string
  readonly builtIn: boolean
  readonly activePanelId: string | null
  readonly settingsPanelId: string
  /** The folder's one page, when its list holds exactly one (the Inbox). */
  readonly solePanelId: string | undefined
}): boolean => {
  if (input.activePanelId === null) return false
  if (input.folderId === 'settings') return input.activePanelId === input.settingsPanelId
  return input.builtIn && input.solePanelId !== undefined && input.solePanelId === input.activePanelId
}

export class StageFold {
  static readonly step = step
  static readonly wants = wants
}
