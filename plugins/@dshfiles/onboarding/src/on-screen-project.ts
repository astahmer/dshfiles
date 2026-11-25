import { EntityLabels, type ThreadDirectories } from '@dshfiles/plugin-ui/hooks/entity-labels'

interface SessionRow {
  readonly parentId?: string | undefined
  readonly retainedBy: { readonly mainView?: number | undefined }
  /** The Session's folder: a New-thread draft is in no workspace's list yet, but its folder names its project. */
  readonly cwd?: string | undefined
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
  /** The VCS providers' thread folders, so a thread in a custom threads directory reads as its project. */
  readonly threadDirectories?: ThreadDirectories | undefined
  /**
   * The Session a surface is about, when it knows it (the New-thread hero's blank Session). The Workbench stage does
   * not retain its Session as the main view, so the hero names its own.
   */
  readonly sessionId?: string | undefined
}): OnScreenProject | null => {
  const workspaceBySession = new Map(input.workspaces.flatMap(workspace => workspace.sessionIds.map(id => [id, workspace] as const)))
  const visited = new Set<string>()
  let cursor = input.sessionId ?? input.sessions.ids.find(id => (input.sessions.byId[id]?.retainedBy.mainView ?? 0) > 0)
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor)
    const workspace = workspaceBySession.get(cursor)
    if (workspace !== undefined) {
      const repository = trimSeparators(EntityLabels.repositoryPath(workspace.path, input.threadDirectories))
      const project = EntityLabels.projectsOf(input.workspaces, input.threadDirectories).find(candidate => trimSeparators(candidate.path) === repository)
      return project === undefined ? null : { projectId: project.workspaceId, title: project.title }
    }
    cursor = input.sessions.byId[cursor]?.parentId
  }
  // A named Session no workspace lists yet (the hero's blank draft) reads as the project its folder belongs to.
  const cwd = input.sessionId === undefined ? undefined : input.sessions.byId[input.sessionId]?.cwd
  if (cwd === undefined || cwd === '') return null
  const repository = trimSeparators(EntityLabels.repositoryPath(cwd, input.threadDirectories))
  const project = EntityLabels.projectsOf(input.workspaces, input.threadDirectories).find(candidate => trimSeparators(candidate.path) === repository)
  return project === undefined ? null : { projectId: project.workspaceId, title: project.title }
}

export class OnScreenProjects {
  static readonly of = of
}
