/**
 * Which trusted actions prepare a fresh thread workspace, and which run when a thread settles.
 *
 * Host-only: the rule needs `node:path`, and the client half reads the same decisions from the Host instead.
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
export const preparationActionsFor = (input: { readonly actions: readonly SetupAction[]; readonly workspace: SetupWorkspace }): readonly SetupAction[] =>
  input.actions.filter(
    action =>
      (action.runOnWorkspaceCreate || action.onSettle) &&
      action.execution.target === 'local' &&
      isWithin(action.root, input.workspace.workspacePath) &&
      isWithin(action.root, input.workspace.repoRoot),
  )
