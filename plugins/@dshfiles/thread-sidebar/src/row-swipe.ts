/**
 * Phone thread rows: swipe left for Done (settle), swipe right for Pin (visual refresh T1.3, plan phone rules
 * "Gestures"), long press for the peek sheet (productivity pass T6.1). The gesture model is the kit's
 * (`@dshfiles/plugin-ui/hooks/row-gestures`, shared with Inbox rows); this file names the thread verbs per side.
 */
import { RowGestureModel, useRowGestures, type RowGestures, type RowSwipeSide } from '@dshfiles/plugin-ui/hooks/row-gestures'

export { ROW_SWIPE_COMMIT_PX } from '@dshfiles/plugin-ui/hooks/row-gestures'
export type RowSwipeAction = 'done' | 'pin'

const ACTION_OF: Readonly<Record<RowSwipeSide, RowSwipeAction>> = { left: 'done', right: 'pin' }
const actionOf = (side: RowSwipeSide | undefined): RowSwipeAction | undefined => (side === undefined ? undefined : ACTION_OF[side])

export const RowSwipeModel = {
  intent: RowGestureModel.intent,
  offset: RowGestureModel.offset,
  /** The action a release at this offset commits, if any: left is Done, right is Pin. */
  action: (dx: number): RowSwipeAction | undefined => actionOf(RowGestureModel.side(dx)),
  /** The action the uncovered side names while dragging (shown under the row), committed or not. */
  revealed: (dx: number): RowSwipeAction | undefined => actionOf(RowGestureModel.revealed(dx)),
} as const

export type RowSwipe = RowGestures

/** Swipe tracking for one row; `enabled` is false on desktop pointers and while the row is renamed. */
export const useRowSwipe = (enabled: boolean, commit: (action: RowSwipeAction) => void, onLongPress?: (row: HTMLElement) => void): RowSwipe =>
  useRowGestures({ swipe: enabled, onSwipe: side => commit(ACTION_OF[side]), onLongPress })
