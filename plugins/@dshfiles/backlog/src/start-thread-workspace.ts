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
 * Where a project thread edits files, as in the New thread row: a new workspace of its own, cut from `base` (the
 * project's main branch when undefined), or the project checkout itself.
 */
export type StartThreadCheckout = { readonly kind: 'own'; readonly base: string | undefined } | { readonly kind: 'in-place' }

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

  /**
   * Whether a placed thread gets its own workspace and from which bookmark. Isolation stays the default a backlog start
   * always had; only a project can be isolated, and a starting bookmark makes sense only for a workspace of its own.
   */
  static checkout(input: {
    readonly placement: StartThreadPlacement
    readonly isolate?: boolean | undefined
    readonly base?: string | undefined
  }): { readonly ok: true; readonly checkout: StartThreadCheckout } | { readonly ok: false; readonly reason: string } {
    if (input.placement.workspaceId === undefined) {
      if (input.base === undefined) return { ok: true, checkout: { kind: 'in-place' } }
      return {
        ok: false,
        reason: `Starting from "${input.base}" needs a registered project to cut a workspace from: pick a project, or leave the starting bookmark out.`,
      }
    }
    if (input.isolate === false) {
      if (input.base === undefined) return { ok: true, checkout: { kind: 'in-place' } }
      return {
        ok: false,
        reason: `A thread that runs in the project checkout cannot start from "${input.base}": choose a new workspace (isolate: true), or leave the starting bookmark out.`,
      }
    }
    return { ok: true, checkout: { kind: 'own', base: input.base } }
  }
}
