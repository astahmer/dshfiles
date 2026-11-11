interface ProjectWorkspace {
  readonly workspaceId: string
  readonly path: string
}

/** Each project workspace's folder name, keyed by workspace id, for labels in front of thread titles. */
const byWorkspaceId = (workspaces: readonly ProjectWorkspace[]): ReadonlyMap<string, string> =>
  new Map(
    workspaces.flatMap(workspace => {
      const name = workspace.path.split(/[\\/]/).filter(Boolean).at(-1)
      return name === undefined ? [] : [[workspace.workspaceId, name] as const]
    }),
  )

export class ProjectNames {
  static readonly byWorkspaceId = byWorkspaceId
}
