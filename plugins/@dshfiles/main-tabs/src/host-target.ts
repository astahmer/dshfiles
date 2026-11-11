import { type ThreadDirectories, WorkspacePaths } from '@dshfiles/thread-sidebar/thread-directories'
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

const NO_THREAD_DIRECTORIES: ThreadDirectories = new Map()

/** A thread's own workspace files under the project thread-sidebar attributes it to, custom threads directory included. */
const owningProject = (workspace: WorkspaceRow, byPath: ReadonlyMap<string, WorkspaceRow>, threadDirectories: ThreadDirectories): WorkspaceRow => {
  const projectPath = WorkspacePaths.projectPathOf({ path: workspace.path, threadDirectories })
  return projectPath === workspace.path ? workspace : (byPath.get(projectPath) ?? workspace)
}

/** Lineage longer than this is a cycle; real subagent chains are a few levels deep. */
const MAX_LINEAGE_HOPS = 1_000

/**
 * Session → owning project, folded once per workspace list. The list changes rarely; the Session list publishes several
 * times a second while a turn streams, so the fold must not follow it.
 */
const projectBySessionOf = (() => {
  const byWorkspaces = new WeakMap<readonly WorkspaceRow[], WeakMap<ThreadDirectories, ReadonlyMap<string, string>>>()
  return (workspaces: readonly WorkspaceRow[], threadDirectories: ThreadDirectories): ReadonlyMap<string, string> => {
    const byDirectories = byWorkspaces.get(workspaces) ?? new WeakMap<ThreadDirectories, ReadonlyMap<string, string>>()
    byWorkspaces.set(workspaces, byDirectories)
    const cached = byDirectories.get(threadDirectories)
    if (cached !== undefined) return cached
    const byPath = new Map(workspaces.map(workspace => [workspace.path, workspace]))
    const bySession = new Map<string, string>()
    for (const workspace of workspaces) {
      const project = owningProject(workspace, byPath, threadDirectories)
      for (const sessionId of workspace.sessionIds) bySession.set(sessionId, project.workspaceId)
    }
    byDirectories.set(threadDirectories, bySession)
    return bySession
  }
})()

/** Resolve a thread or subagent to its owning project workspace, when one is known. */
export const createThreadWorkspaceResolver = (input: {
  readonly byId: Readonly<Record<string, SessionRow | undefined>>
  readonly workspaces: readonly WorkspaceRow[]
  readonly threadDirectories?: ThreadDirectories | undefined
}): ((sessionId: string) => string | undefined) => {
  const bySession = projectBySessionOf(input.workspaces, input.threadDirectories ?? NO_THREAD_DIRECTORIES)
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
  readonly threadDirectories?: ThreadDirectories | undefined
}): HostView => {
  if (input.activePanelId !== null) return { target: { kind: 'panel', panelId: input.activePanelId }, projectId: null }
  const currentSessionId = input.currentSessionId
  if (currentSessionId === undefined || !Object.hasOwn(input.byId, currentSessionId) || input.byId[currentSessionId] === undefined)
    return { target: null, projectId: null }
  const projectId =
    createThreadWorkspaceResolver({ byId: input.byId, workspaces: input.workspaces, threadDirectories: input.threadDirectories })(currentSessionId) ?? null
  return { target: { kind: 'thread', sessionId: currentSessionId }, projectId }
}
