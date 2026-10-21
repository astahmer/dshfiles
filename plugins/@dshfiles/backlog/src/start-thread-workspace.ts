import type { StartThreadTarget } from './start-thread.js'

/** What jj-integration answers after a thread asks for its own jj workspace. */
export interface ProvisionedThreadWorkspace {
  readonly workspaceId: string
}

/** Where a backlog-started thread runs before its Session exists. */
export interface StartThreadPlacement {
  /** The workspace to create the Session in; a just-provisioned id here may not be listed yet. */
  readonly workspaceId: string | undefined
  /** The bare folder the item named, used when no workspace can hold the thread. */
  readonly cwd: string | undefined
}

/**
 * A thread started from an item always gets its own jj workspace, whatever the isolate-by-default setting says: work
 * captured in the backlog is independent, so it must not share the checkout another thread is editing. Outside a jj
 * repository, or without jj-integration, `provision` answers the same workspace and the thread starts there.
 */
export const isolateStartThread = async (input: {
  readonly target: StartThreadTarget
  readonly defaultWorkspaceId: string | undefined
  readonly provision: (workspaceId: string) => Promise<ProvisionedThreadWorkspace>
}): Promise<StartThreadPlacement> => {
  if (input.target.kind === 'cwd') return { workspaceId: undefined, cwd: input.target.path }
  const base = input.target.kind === 'project' ? input.target.projectId : input.defaultWorkspaceId
  if (base === undefined) return { workspaceId: undefined, cwd: undefined }
  const provisioned = await input.provision(base)
  return { workspaceId: provisioned.workspaceId, cwd: undefined }
}
