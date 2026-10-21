/** One registered workspace a started thread can be cut from, as the Host registry reports it. */
export interface StartThreadWorkspace {
  readonly id: string
  readonly path: string
}

/** Where a started thread runs before its Session exists. */
export interface StartThreadPlacement {
  /** The workspace to create the Session in; a just-provisioned id here may not be listed yet. */
  readonly workspaceId: string | undefined
  /** The bare folder the item named, used when no workspace can hold the thread. */
  readonly cwd: string | undefined
}

/**
 * Which workspace a thread started from an item runs in. A caller that already knows the target (the dialog does) names
 * it; without one the first item's own project decides, a project path no workspace claims becomes a bare folder, and
 * an item with no project joins the first registered workspace, the way the composer's New thread does.
 */
export class StartThreadPlacementPlan {
  static of(input: {
    readonly workspaceId?: string | undefined
    readonly cwd?: string | undefined
    /** Every registered workspace, in the order the Host lists them. */
    readonly registered: readonly StartThreadWorkspace[]
    /** Each item's project path, the first one deciding when the caller named no target. */
    readonly itemProjects: readonly (string | null)[]
  }): StartThreadPlacement {
    if (input.cwd !== undefined) return { workspaceId: undefined, cwd: input.cwd }
    if (input.workspaceId !== undefined) return { workspaceId: input.workspaceId, cwd: undefined }
    const itemPath = input.itemProjects.find(project => project !== null) ?? null
    if (itemPath === null) return { workspaceId: input.registered[0]?.id, cwd: undefined }
    const project = input.registered.find(candidate => candidate.path === itemPath)
    return project === undefined ? { workspaceId: undefined, cwd: itemPath } : { workspaceId: project.id, cwd: undefined }
  }
}
