export interface BacklogProjectTargetPorts {
  /** The registered workspace a directory belongs to: the session's cwd is the thread workspace itself, or below it. */
  readonly workspaceAt: (path: string) => Promise<{ readonly id: string; readonly path: string } | undefined>
  /** The project checkout that workspace was cut from, or null when the workspace is a project of its own. */
  readonly projectOf: (workspaceId: string) => Promise<{ readonly path: string } | null>
}

/**
 * The project a capture made in `cwd` belongs to. jj studies the answer, not the folder name: a thread workspace is
 * whatever jj says was cut from a project, so a custom threads directory or a legacy workspace name still files the
 * item under its project. Without that answer the path stays as it is.
 */
export class BacklogProjectTarget {
  static async of(cwd: string, ports: BacklogProjectTargetPorts): Promise<string> {
    const workspace = await ports.workspaceAt(cwd)
    if (workspace === undefined) return cwd
    const project = await ports.projectOf(workspace.id)
    if (project === null || project.path === workspace.path) return workspace.path
    return project.path
  }
}
