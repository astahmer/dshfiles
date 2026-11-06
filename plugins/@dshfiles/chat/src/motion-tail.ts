/** How long fold transitions stay enabled after a Turn stops running. */
export const MOTION_TAIL_MS = 800

/** Fold transitions run while a Turn is live and briefly after it settles, never while they are deferred off. */
export type MotionTail = 'off' | 'running' | 'settling'

/** The tail phase one observation implies; `settling` is left to the caller's timer. */
export const motionTailNext = (
  current: MotionTail,
  input: {
    readonly running: boolean
    readonly deferCompletedTurns: boolean
  },
): MotionTail => {
  if (!input.deferCompletedTurns) return 'off'
  if (input.running) return 'running'
  return current === 'off' ? 'off' : 'settling'
}
