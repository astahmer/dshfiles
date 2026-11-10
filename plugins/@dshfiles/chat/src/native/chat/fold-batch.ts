/**
 * Lifetime of one viewport's fold batch: scheduled by a commit, started by the next frame clock,
 * cancelled by a reading gesture, then settling while it commits hidden rows and final geometry.
 * One transition function owns the whole lifecycle; animation frames, timers and box writes are
 * effects of the state it returns.
 */
export type FoldBatchState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'scheduled'; readonly epoch: number }
  | { readonly kind: 'running'; readonly cancelled: boolean }
  | { readonly kind: 'settling' }

export type FoldBatchEvent =
  | { readonly kind: 'schedule'; readonly epoch: number }
  | { readonly kind: 'start'; readonly epoch: number }
  | { readonly kind: 'release' }
  | { readonly kind: 'cancelInput' }
  | { readonly kind: 'resumeInput' }
  | { readonly kind: 'settle' }
  | { readonly kind: 'settled' }
  | { readonly kind: 'clear' }

export type FoldBatchEffect =
  /** The scheduled microtask may run the batch now. */
  | 'begin'
  /** No batch will run; held boxes finish or start their own transitions. */
  | 'releaseHeld'
  /** Write hidden rows and final geometry, then dispatch `settled`. */
  | 'commit'
  /** Fold-idle listeners run once no owned row and no settling batch remains. */
  | 'notifyIdle'
  /** Drop frame and cleanup handles for the batch that is going away. */
  | 'clear'

export interface FoldBatchStep {
  readonly state: FoldBatchState
  readonly effects: readonly FoldBatchEffect[]
}

const idleState: FoldBatchState = { kind: 'idle' }
const settled: Omit<FoldBatchStep, 'state'> = { effects: [] }
const unchanged = (state: FoldBatchState): FoldBatchStep => ({ state, ...settled })

/**
 * Apply one lifecycle event.
 * @param state - current batch lifetime.
 * @param event - what happened to the viewport's fold work.
 * @returns the next lifetime and the effects it owns.
 */
export function applyFoldBatch(state: FoldBatchState, event: FoldBatchEvent): FoldBatchStep {
  switch (event.kind) {
    case 'schedule':
      return state.kind === 'idle'
        ? { state: { kind: 'scheduled', epoch: event.epoch }, effects: [] }
        : unchanged(state)
    case 'start':
      if (state.kind !== 'scheduled' || state.epoch !== event.epoch) return unchanged(state)
      return { state: { kind: 'running', cancelled: false }, effects: ['begin'] }
    case 'release':
      return state.kind === 'scheduled' ? { state: idleState, effects: ['releaseHeld'] } : unchanged(state)
    case 'cancelInput':
      return state.kind === 'running' && !state.cancelled
        ? { state: { kind: 'running', cancelled: true }, effects: [] }
        : unchanged(state)
    case 'resumeInput':
      return state.kind === 'running' && state.cancelled
        ? { state: { kind: 'running', cancelled: false }, effects: [] }
        : unchanged(state)
    case 'settle':
      return state.kind === 'running' ? { state: { kind: 'settling' }, effects: ['commit'] } : unchanged(state)
    case 'settled':
      return state.kind === 'settling' ? { state: idleState, effects: ['notifyIdle'] } : unchanged(state)
    case 'clear':
      return state.kind === 'idle' ? unchanged(state) : { state: idleState, effects: ['clear'] }
  }
}

/** @returns whether a batch is scheduled or running, so its frame clock owns the viewport. */
export const batchActive = (state: FoldBatchState): boolean => state.kind === 'scheduled' || state.kind === 'running'

/** @returns whether a reading gesture stopped the running batch's automatic target. */
export const batchCancelled = (state: FoldBatchState): boolean => state.kind === 'running' && state.cancelled
