import type { HostTarget } from '@dshfiles/workbench/tabs'

interface SessionRow {
  readonly parentId?: string | undefined
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
  const parent = workspace.path.slice(0, Math.max(workspace.path.lastIndexOf('/'), workspace.path.lastIndexOf('\\')))
  if (!parent.endsWith(THREADS_DIRECTORY_SUFFIX)) return workspace
  return byPath.get(parent.slice(0, -THREADS_DIRECTORY_SUFFIX.length)) ?? workspace
}

/** Lineage longer than this is a cycle; real subagent chains are a few levels deep. */
const MAX_LINEAGE_HOPS = 1_000

/**
 * Session → owning project, folded once per workspace list. The list changes rarely; the Session list publishes several
 * times a second while a turn streams, so the fold must not follow it.
 */
const projectBySessionOf = (() => {
  const byWorkspaces = new WeakMap<readonly WorkspaceRow[], ReadonlyMap<string, string>>()
  return (workspaces: readonly WorkspaceRow[]): ReadonlyMap<string, string> => {
    const cached = byWorkspaces.get(workspaces)
    if (cached !== undefined) return cached
    const byPath = new Map(workspaces.map(workspace => [workspace.path, workspace]))
    const bySession = new Map<string, string>()
    for (const workspace of workspaces) {
      const project = owningProject(workspace, byPath)
      for (const sessionId of workspace.sessionIds) bySession.set(sessionId, project.workspaceId)
    }
    byWorkspaces.set(workspaces, bySession)
    return bySession
  }
})()

/** Resolve a thread or subagent to its owning project workspace, when one is known. */
export const createThreadWorkspaceResolver = (input: {
  readonly byId: Readonly<Record<string, SessionRow | undefined>>
  readonly workspaces: readonly WorkspaceRow[]
}): ((sessionId: string) => string | undefined) => {
  const bySession = projectBySessionOf(input.workspaces)
  return (sessionId: string): string | undefined => {
    let cursor: string | undefined = sessionId
    for (let hop = 0; cursor !== undefined && hop < MAX_LINEAGE_HOPS; hop += 1) {
      const projectId = bySession.get(cursor)
      if (projectId !== undefined) return projectId
      cursor = Object.hasOwn(input.byId, cursor) ? input.byId[cursor]?.parentId : undefined
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
  readonly byId: Readonly<Record<string, SessionRow | undefined>>
  readonly workspaces: readonly WorkspaceRow[]
}): HostView => {
  if (input.activePanelId !== null) return { target: { kind: 'panel', panelId: input.activePanelId }, projectId: null }
  const currentSessionId = input.currentSessionId
  if (currentSessionId === undefined || !Object.hasOwn(input.byId, currentSessionId) || input.byId[currentSessionId] === undefined)
    return { target: null, projectId: null }
  const projectId = createThreadWorkspaceResolver({ byId: input.byId, workspaces: input.workspaces })(currentSessionId) ?? null
  return { target: { kind: 'thread', sessionId: currentSessionId }, projectId }
}
