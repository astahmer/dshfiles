import { PackPlan, type PackPreview, type PackSummary, type StepResult } from './pack-plan.js'

/**
 * One pack change in the dialog: review the preview, work through its plugins one Host call at a time, then show the
 * verdict. Cancelling while applying stops before the next plugin (the running one finishes, so its result is known).
 */
export type PackChangeState =
  | { readonly phase: 'reviewing' }
  | {
      readonly phase: 'applying'
      readonly preview: PackPreview
      /** The plugin being applied is `queue[0]`. */
      readonly queue: readonly string[]
      readonly results: readonly StepResult[]
      readonly cancelRequested: boolean
    }
  | { readonly phase: 'finished'; readonly preview: PackPreview; readonly results: readonly StepResult[]; readonly summary: PackSummary }

export type PackChangeEvent =
  | { readonly type: 'confirm'; readonly preview: PackPreview }
  | { readonly type: 'cancel' }
  | { readonly type: 'step-done'; readonly plugin: string; readonly results: readonly StepResult[] }
  | { readonly type: 'step-failed'; readonly plugin: string; readonly reason: string }

const stepOf = (preview: PackPreview, plugin: string): StepResult['step'] => (preview.change.some(step => step.plugin === plugin) ? preview.action : 'install')

const finish = (preview: PackPreview, results: readonly StepResult[]): PackChangeState => ({
  phase: 'finished',
  preview,
  results,
  summary: PackPlan.summarize({ preview, results }),
})

const transition = (state: PackChangeState, event: PackChangeEvent): PackChangeState => {
  if (state.phase === 'reviewing') {
    if (event.type !== 'confirm') return state
    const queue = PackPlan.stepsOf(event.preview)
    return queue.length === 0 ? finish(event.preview, []) : { phase: 'applying', preview: event.preview, queue, results: [], cancelRequested: false }
  }
  if (state.phase !== 'applying') return state
  if (event.type === 'cancel') return { ...state, cancelRequested: true }
  if (event.type === 'confirm' || event.plugin !== state.queue[0]) return state
  const step = stepOf(state.preview, event.plugin)
  const own =
    event.type === 'step-failed'
      ? [{ plugin: event.plugin, step, status: 'failed' as const, restartReason: null, detail: event.reason }]
      : event.results.length > 0
        ? event.results
        : [{ plugin: event.plugin, step, status: 'applied' as const, restartReason: null, detail: 'nothing left to change' }]
  const results = [...state.results, ...own]
  const rest = state.queue.slice(1)
  // An unanswered call leaves the Host's state unknown: stop rather than stack more changes on it.
  if (event.type === 'step-failed' || state.cancelRequested)
    return finish(state.preview, [
      ...results,
      ...rest.map(plugin => ({ plugin, step: stepOf(state.preview, plugin), status: 'cancelled' as const, restartReason: null, detail: null })),
    ])
  return rest.length === 0 ? finish(state.preview, results) : { ...state, queue: rest, results }
}

export class PackChangeFlow {
  static readonly initial: PackChangeState = { phase: 'reviewing' }
  static readonly transition = transition
}
