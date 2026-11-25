/**
 * One chrome (round five B1). Folding the left column hides only its list: the rail keeps its labels and order, and the
 * header row (the wordmark, Back, Forward, New thread, ⌘K) keeps the place and width it has open. The frame's folded
 * track is the rail's width, so that row is drawn over the top edge of the stage, and the main tab strip (main-tabs', or
 * the Workbench main region's top-left tab row) pads by the part that overhangs the track (`--dshfiles-sidebar-overhang`,
 * set by `client.css` only while such a strip is mounted and zen mode is off). A phone and a hidden track (the macOS desktop app, a drawer) keep their own chrome.
 */

/** The rail's width open and folded: the frame's folded track (56 px) holds it whole, so folding never moves it. */
const RAIL_WIDTH = 56
/** A track at most this wide is the folded rail; an open column is never narrower than the frame's 264 px floor. */
const TRACK_MAX = 64
/** The open width before the column was ever seen open: the frame's default. */
const OPEN_FALLBACK = 280
/** On `<html>` while a folded column draws its header over the stage. */
const ROOT_ATTRIBUTE = 'data-sidebar-folded'
/** On `<html>`: how far that header reaches past the folded track, in px. */
const OVERHANG_VARIABLE = '--dshfiles-sidebar-folded-overhang'

/** Does the column, as the frame gives it, draw its open header over the stage? */
const overhangs = (input: { readonly collapsed: boolean; readonly phone: boolean; readonly width: number }): boolean =>
  input.collapsed && !input.phone && input.width > 0 && input.width <= TRACK_MAX

/** The part of the open header row past the folded track. */
const overhang = (openWidth: number, trackWidth: number): number => Math.max(0, Math.round(openWidth - trackWidth))

export class SidebarFold {
  static readonly RAIL_WIDTH = RAIL_WIDTH
  static readonly TRACK_MAX = TRACK_MAX
  static readonly OPEN_FALLBACK = OPEN_FALLBACK
  static readonly ROOT_ATTRIBUTE = ROOT_ATTRIBUTE
  static readonly OVERHANG_VARIABLE = OVERHANG_VARIABLE
  static readonly overhangs = overhangs
  static readonly overhang = overhang
}
