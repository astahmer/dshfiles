/**
 * Which trusted actions prepare a fresh thread workspace, and how their durable tasks read.
 *
 * Published as the `@dshfiles/project-checks/workspace-setup` dshx module: `@dshfiles/jj-integration` dispatches the
 * selection through the existing durable queue instead of running a second runner, and renders the same phases.
 */
import { isAbsolute, relative, sep } from 'node:path'

/** One configured action, as far as setup cares: what it is called and which trusted root it runs under. */
export interface SetupAction {
  readonly id: string
  readonly label: string
  readonly root: string
  readonly runOnWorkspaceCreate: boolean
  readonly awaitBeforeFirstTurn: boolean
  readonly onSettle: boolean
  readonly execution: { readonly target: 'local' | 'remote' | 'auto' }
}

/** The workspace the setup runs in and the checkout it belongs to. */
export interface SetupWorkspace {
  /** A thread workspace is created beside the project checkout, not inside it, so a setup root must span both. */
  readonly repoRoot: string
  readonly workspacePath: string
}

const isWithin = (root: string, target: string): boolean => {
  if (!isAbsolute(root) || !isAbsolute(target)) return false
  const pathFromRoot = relative(root, target)
  return pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
}

/**
 * The actions to run once in a new workspace. A trusted root narrows where a command may run, so an action only
 * qualifies when its root contains both the checkout and the workspace: a root that covers the checkout alone cannot
 * reach a thread workspace created beside it, and this never widens the root to reach one.
 */
export const setupActionsFor = (input: { readonly actions: readonly SetupAction[]; readonly workspace: SetupWorkspace }): readonly SetupAction[] =>
  input.actions.filter(
    action =>
      action.runOnWorkspaceCreate &&
      action.execution.target === 'local' &&
      isWithin(action.root, input.workspace.workspacePath) &&
      isWithin(action.root, input.workspace.repoRoot),
  )

/** The actions to run when one of a project's threads settles. */
export const settleActionsFor = (input: { readonly actions: readonly SetupAction[]; readonly workspace: SetupWorkspace }): readonly SetupAction[] =>
  input.actions.filter(
    action =>
      action.onSettle &&
      action.execution.target === 'local' &&
      isWithin(action.root, input.workspace.repoRoot) &&
      isWithin(action.root, input.workspace.workspacePath),
  )

/** Every action either trigger may run, which is what the workspace-setup read reports. */
export const preparationActionsFor = (input: {
  readonly actions: readonly SetupAction[]
  readonly workspace: SetupWorkspace
}): readonly SetupAction[] =>
  input.actions.filter(
    action =>
      (action.runOnWorkspaceCreate || action.onSettle) &&
      action.execution.target === 'local' &&
      isWithin(action.root, input.workspace.workspacePath) &&
      isWithin(action.root, input.workspace.repoRoot),
  )

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
