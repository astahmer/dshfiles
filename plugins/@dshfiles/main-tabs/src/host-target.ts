import type { HostTarget } from '@dshfiles/workbench/tabs'

interface SessionRow {
  readonly id: string
  readonly parentId?: string | undefined
  readonly retainedBy: { readonly mainView?: number | undefined }
}

interface WorkspaceRow {
  readonly workspaceId: string
  readonly path: string
  readonly sessionIds: readonly string[]
}

export interface HostView {
  readonly target: HostTarget | null
  readonly projectId: string | null
}

const THREADS_DIRECTORY_SUFFIX = '-threads'

/** jj-integration puts a thread's own workspace at `<project>-threads/<name>`; thread-sidebar files it under `<project>`. */
const owningProject = (workspace: WorkspaceRow, byPath: ReadonlyMap<string, WorkspaceRow>): WorkspaceRow => {
  const parent = workspace.path.slice(0, workspace.path.lastIndexOf('/'))
  if (!parent.endsWith(THREADS_DIRECTORY_SUFFIX)) return workspace
  return byPath.get(parent.slice(0, -THREADS_DIRECTORY_SUFFIX.length)) ?? workspace
}

/** Resolve a thread or subagent to its owning project workspace, when one is known. */
export const createThreadWorkspaceResolver = (input: {
  readonly sessions: readonly Pick<SessionRow, 'id' | 'parentId'>[]
  readonly workspaces: readonly WorkspaceRow[]
}): ((sessionId: string) => string | undefined) => {
  const byPath = new Map(input.workspaces.map(workspace => [workspace.path, workspace]))
  const bySession = new Map<string, string>()
  for (const workspace of input.workspaces) {
    const project = owningProject(workspace, byPath)
    for (const sessionId of workspace.sessionIds) bySession.set(sessionId, project.workspaceId)
  }
  const parents = new Map(input.sessions.map(session => [session.id, session.parentId]))
  return (sessionId: string): string | undefined => {
    const visited = new Set<string>()
    let cursor: string | undefined = sessionId
    while (cursor !== undefined && !visited.has(cursor)) {
      visited.add(cursor)
      const projectId = bySession.get(cursor)
      if (projectId !== undefined) return projectId
      cursor = parents.get(cursor)
    }
    return undefined
  }
}

/**
 * What the main view shows: a global panel, the exact current Session binding, or nothing (the
 * New thread screen). Retain counts do not select a Session. Threads carry their owning project.
 */
export const readHostView = (input: {
  readonly activePanelId: string | null
  readonly currentSessionId: string | undefined
  readonly sessions: readonly SessionRow[]
  readonly workspaces: readonly WorkspaceRow[]
}): HostView => {
  if (input.activePanelId !== null) return { target: { kind: 'panel', panelId: input.activePanelId }, projectId: null }
  const current = input.sessions.find(session => session.id === input.currentSessionId)
  if (current === undefined) return { target: null, projectId: null }
  const projectId = createThreadWorkspaceResolver({ sessions: input.sessions, workspaces: input.workspaces })(current.id) ?? null
  return { target: { kind: 'thread', sessionId: current.id }, projectId }
}
