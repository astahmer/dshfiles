import { EntityLabels } from '@dshfiles/plugin-ui/hooks/entity-labels'

interface SessionRow {
  readonly parentId?: string | undefined
  readonly retainedBy: { readonly mainView?: number | undefined }
}

interface WorkspaceRow {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

/** The registered project a Try it demo starts in. */
export interface OnScreenProject {
  readonly projectId: string
  readonly title: string
}

const trimSeparators = (path: string): string => path.replace(/[\\/]+$/u, '')

/**
 * The project of the Session in the main view (the New-thread screen's blank Session included), found as the command
 * palette's Ask DSH finds it: the workspace that lists the Session or its nearest listed parent. A thread workspace
 * reads as the project it was cut from; `null` when nothing in the main view belongs to a registered project.
 */
const of = (input: {
  readonly sessions: { readonly ids: readonly string[]; readonly byId: Readonly<Record<string, SessionRow | undefined>> }
  readonly workspaces: readonly WorkspaceRow[]
}): OnScreenProject | null => {
  const workspaceBySession = new Map(input.workspaces.flatMap(workspace => workspace.sessionIds.map(id => [id, workspace] as const)))
  const visited = new Set<string>()
  let cursor = input.sessions.ids.find(id => (input.sessions.byId[id]?.retainedBy.mainView ?? 0) > 0)
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor)
    const workspace = workspaceBySession.get(cursor)
    if (workspace !== undefined) {
      const repository = trimSeparators(EntityLabels.repositoryPath(workspace.path))
      const project = EntityLabels.projectsOf(input.workspaces).find(candidate => trimSeparators(candidate.path) === repository)
      return project === undefined ? null : { projectId: project.workspaceId, title: project.title }
    }
    cursor = input.sessions.byId[cursor]?.parentId
  }
  return null
}

export class OnScreenProjects {
  static readonly of = of
}
