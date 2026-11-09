/**
 * How a dispatched setup action reads: whether it still holds the first turn, and whether the card has anything to say.
 *
 * Client-safe (no node: imports): `@dshfiles/jj-integration` imports this module in both halves to render the same view.
 */

/** Durable task statuses that still hold the first turn, and those that never will. */
const OPEN_STATUSES = ['queued', 'running', 'cancel-requested', 'unknown'] as const
const FINISHED_STATUSES = ['succeeded', 'failed', 'cancelled', 'timed-out', 'blocked'] as const

export type SetupTaskStatus = (typeof OPEN_STATUSES)[number] | (typeof FINISHED_STATUSES)[number]

/** One dispatched setup action: the queue's own status plus the action it belongs to, for the card. */
export interface SetupTaskView {
  readonly id: string
  readonly actionId: string
  readonly label: string
  readonly status: SetupTaskStatus
  /** `queued` | `resolving` | `starting` | `recording` | `reconciling`, from the attempt in flight. */
  readonly phase: 'queued' | 'resolving' | 'starting' | 'recording' | 'reconciling'
}

export const isSetupOpen = (status: SetupTaskStatus): boolean => (OPEN_STATUSES as readonly string[]).includes(status)

/** Whether a card is worth showing: something is still running, or something already ran. */
export const setupView = (tasks: readonly SetupTaskView[]): { readonly tasks: readonly SetupTaskView[]; readonly open: boolean; readonly failed: boolean } => ({
  tasks,
  open: tasks.some(task => isSetupOpen(task.status)),
  failed: tasks.some(task => task.status === 'failed' || task.status === 'timed-out' || task.status === 'blocked'),
})
