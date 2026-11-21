/**
 * The phone thread drawer's gesture model (Settings › phoneNavigation 'drawer'): a rightward swipe on the stage (from
 * the left edge or anywhere else), or a swipe left on the open drawer or its scrim, drags the drawer with the finger; on
 * release it snaps open or closed by the distance covered and the release velocity. Axis locking reuses
 * {@link EdgeSwipeModel}: opening locks like the left edge's swipe, closing like a swipe in from the right (leftward and
 * mostly sideways).
 *
 * Opening is not limited to the edge band, as in the ChatGPT and Claude Android apps: Android's gesture navigation and
 * Chrome's back swipe own the screen's left edge, so a page never sees most edge touches there.
 */
import { EdgeSwipeModel, type EdgeSwipeIntent } from './edge-swipe.js'

/** The drawer covers this share of the viewport, up to {@link DRAWER_MAX_WIDTH_PX}. */
export const DRAWER_WIDTH_RATIO = 0.85
export const DRAWER_MAX_WIDTH_PX = 360
/** A release faster than this (px/ms, about a flick) follows its direction whatever the distance. */
export const DRAWER_FLICK_VELOCITY = 0.4
/** Velocity is measured over the last samples within this window, so a pause before release reads as still. */
const VELOCITY_WINDOW_MS = 100

export interface DrawerSample {
  readonly x: number
  readonly t: number
}

/** Where an opening drag started: the edge band (the drawer mounts at once) or elsewhere on the stage. */
export type DrawerOpeningOrigin = 'edge' | 'stage'

export const DrawerGestureModel = {
  /** A touch on the screen may open a closed drawer from anywhere; the edge band is told apart. */
  openingOrigin: (input: { readonly x: number; readonly width: number }): DrawerOpeningOrigin | null => {
    if (input.x < 0 || input.x > input.width) return null
    return EdgeSwipeModel.starts({ side: 'left', x: input.x, width: input.width }) ? 'edge' : 'stage'
  },
  width: (viewportWidth: number): number => Math.round(Math.min(viewportWidth * DRAWER_WIDTH_RATIO, DRAWER_MAX_WIDTH_PX)),
  /** How open the drawer is, 0 (closed) to 1 (open), for a finger `dx` from where it started. */
  progress: (input: { readonly startedOpen: boolean; readonly dx: number; readonly width: number }): number => {
    if (input.width <= 0) return input.startedOpen ? 1 : 0
    const offset = (input.startedOpen ? input.width : 0) + input.dx
    return Math.min(1, Math.max(0, offset / input.width))
  },
  /** Opening locks like the left edge's swipe; closing like a leftward swipe from the right edge. */
  intent: (input: { readonly startedOpen: boolean; readonly current: EdgeSwipeIntent; readonly dx: number; readonly dy: number }): EdgeSwipeIntent =>
    EdgeSwipeModel.intent({ side: input.startedOpen ? 'right' : 'left', current: input.current, dx: input.dx, dy: input.dy }),
  /** Horizontal velocity in px/ms over the recent samples (positive: rightward, towards open). */
  velocity: (samples: readonly DrawerSample[]): number => {
    const last = samples.at(-1)
    if (last === undefined) return 0
    const first = samples.find(sample => last.t - sample.t <= VELOCITY_WINDOW_MS) ?? last
    const elapsed = last.t - first.t
    return elapsed <= 0 ? 0 : (last.x - first.x) / elapsed
  },
  /** Where a released drag settles: a flick follows its direction, otherwise the nearer side. */
  settlesOpen: (input: { readonly progress: number; readonly velocity: number }): boolean => {
    if (Math.abs(input.velocity) >= DRAWER_FLICK_VELOCITY) return input.velocity > 0
    return input.progress >= 0.5
  },
} as const
