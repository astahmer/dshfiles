import type { TabTarget } from './tabs-machine.js'

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
  readonly target: TabTarget | null
  readonly projectId: string | null
}

const THREADS_DIRECTORY_SUFFIX = '-threads'

/** jj-integration puts a thread's own workspace at `<project>-threads/<name>`; thread-sidebar files it under `<project>`. */
const owningProject = (workspace: WorkspaceRow, byPath: ReadonlyMap<string, WorkspaceRow>): WorkspaceRow => {
  const parent = workspace.path.slice(0, workspace.path.lastIndexOf('/'))
  if (!parent.endsWith(THREADS_DIRECTORY_SUFFIX)) return workspace
  return byPath.get(parent.slice(0, -THREADS_DIRECTORY_SUFFIX.length)) ?? workspace
}

/**
 * What the main view shows: a global panel, the Conversation of the Session the main view retains, or nothing (the
 * New thread screen). Threads carry the project they belong to, following subagents up to their parent.
 */
export const readHostView = (input: {
  readonly activePanelId: string | null
  readonly sessions: readonly SessionRow[]
  readonly workspaces: readonly WorkspaceRow[]
}): HostView => {
  if (input.activePanelId !== null) return { target: { kind: 'panel', panelId: input.activePanelId }, projectId: null }
  const current = input.sessions.find(session => (session.retainedBy.mainView ?? 0) > 0)
  if (current === undefined) return { target: null, projectId: null }
  const byPath = new Map(input.workspaces.map(workspace => [workspace.path, workspace]))
  const bySession = new Map(
    input.workspaces.flatMap(workspace => workspace.sessionIds.map(sessionId => [sessionId, owningProject(workspace, byPath)] as const)),
  )
  const parents = new Map(input.sessions.map(session => [session.id, session.parentId]))
  const visited = new Set<string>()
  let cursor: string | undefined = current.id
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor)
    const project = bySession.get(cursor)
    if (project !== undefined) return { target: { kind: 'thread', sessionId: current.id }, projectId: project.workspaceId }
    cursor = parents.get(cursor)
  }
  return { target: { kind: 'thread', sessionId: current.id }, projectId: null }
}
