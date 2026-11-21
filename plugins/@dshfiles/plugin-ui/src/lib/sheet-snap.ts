/** Pure model of a draggable phone bottom sheet: its snap points, how it follows the finger and where a release lands. */

/** Visible heights in px: where the sheet rests when it opens, and how tall it may grow when dragged up. */
export interface SheetSnapLayout {
  readonly rest: number
  readonly expanded: number
}

export type SheetSnapPoint = 'dismissed' | 'rest' | 'expanded'

export interface SheetDragSample {
  readonly y: number
  readonly time: number
}

/** A release below this share of the resting height dismisses the sheet. */
export const SHEET_DISMISS_RATIO = 0.7
/** A release faster than this (px/ms) moves to the next snap point in its direction, however short the drag. */
export const SHEET_FLICK_PX_PER_MS = 0.5
/** An expanded height this close to the resting one is no separate snap point. */
const EXPAND_MIN_PX = 24
/** Only the last stretch of the drag decides the release velocity: an early fast pull followed by a pause is no flick. */
const VELOCITY_WINDOW_MS = 100
/** How far past its tallest snap point the sheet stretches, at most, however far the finger goes. */
const RUBBER_BAND_PX = 64

const canExpand = (layout: SheetSnapLayout): boolean => layout.expanded - layout.rest >= EXPAND_MIN_PX

export const SheetSnap = {
  /** The snap points from lowest to highest, with the height each one shows. */
  points(layout: SheetSnapLayout): readonly { readonly point: SheetSnapPoint; readonly height: number }[] {
    const base = [
      { point: 'dismissed', height: 0 },
      { point: 'rest', height: layout.rest },
    ] as const
    return canExpand(layout) ? [...base, { point: 'expanded', height: layout.expanded }] : base
  },

  heightOf(layout: SheetSnapLayout, point: SheetSnapPoint): number {
    if (point === 'dismissed') return 0
    return point === 'expanded' && canExpand(layout) ? layout.expanded : layout.rest
  },

  /** The visible height while the finger is `dy` px below where it started; past the top it stretches less and less. */
  follow(input: { readonly layout: SheetSnapLayout; readonly startHeight: number; readonly dy: number }): number {
    const top = SheetSnap.heightOf(input.layout, 'expanded')
    const raw = input.startHeight - input.dy
    if (raw <= 0) return 0
    if (raw <= top) return raw
    const over = raw - top
    return top + (RUBBER_BAND_PX * over) / (over + RUBBER_BAND_PX)
  },

  /** Keep the samples still inside the velocity window of the newest one. */
  remember(samples: readonly SheetDragSample[], next: SheetDragSample): readonly SheetDragSample[] {
    return [...samples.filter(sample => next.time - sample.time <= VELOCITY_WINDOW_MS), next]
  },

  /** Release velocity in px/ms, positive downward, over the window; 0 without two samples apart in time. */
  velocity(samples: readonly SheetDragSample[]): number {
    const first = samples[0]
    const last = samples.at(-1)
    if (first === undefined || last === undefined || last.time <= first.time) return 0
    return (last.y - first.y) / (last.time - first.time)
  },

  /**
   * Where a release at `height` lands: a flick goes to the next snap point in its direction; otherwise below
   * `SHEET_DISMISS_RATIO` of the resting height dismisses and above it the nearer of rest and expanded wins.
   */
  settle(input: { readonly layout: SheetSnapLayout; readonly height: number; readonly velocity: number }): SheetSnapPoint {
    const points = SheetSnap.points(input.layout)
    if (input.velocity > SHEET_FLICK_PX_PER_MS) {
      return points.filter(entry => entry.height < input.height - 1).at(-1)?.point ?? 'dismissed'
    }
    if (input.velocity < -SHEET_FLICK_PX_PER_MS) {
      return points.find(entry => entry.height > input.height + 1)?.point ?? points.at(-1)?.point ?? 'rest'
    }
    if (input.height < input.layout.rest * SHEET_DISMISS_RATIO) return 'dismissed'
    const upper = points.filter(entry => entry.point !== 'dismissed')
    return upper.reduce((best, entry) => (Math.abs(entry.height - input.height) < Math.abs(best.height - input.height) ? entry : best)).point
  },
}
