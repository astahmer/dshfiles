import type { CleanupTarget } from './api.js'

interface CleanupWorkspaceRow {
  readonly repoRoot: string
  readonly name: string
  readonly kind: Exclude<CleanupTarget['kind'], 'untracked'>
}

interface CleanupUntrackedRow {
  readonly repoRoot: string
  readonly name: string
}

const targetKey = (target: CleanupTarget): string => JSON.stringify([target.repoRoot, target.name, target.kind])

/** A selected preview row is only a hint: removal still scans and rechecks the candidates immediately beforehand. */
export const filterCleanupTargets = <Workspace extends CleanupWorkspaceRow, Untracked extends CleanupUntrackedRow>(input: {
  readonly targets?: readonly CleanupTarget[]
  readonly workspaces: readonly Workspace[]
  readonly untracked: readonly Untracked[]
}) => {
  if (input.targets === undefined) return { workspaces: [...input.workspaces], untracked: [...input.untracked] }

  const targets = new Set(input.targets.map(targetKey))
  return {
    workspaces: input.workspaces.filter(workspace => targets.has(targetKey(workspace))),
    untracked: input.untracked.filter(entry => targets.has(targetKey({ ...entry, kind: 'untracked' }))),
  }
}
