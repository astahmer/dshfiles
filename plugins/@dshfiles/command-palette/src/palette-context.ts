import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PaletteActionContext, PaletteThemePreference, PaletteWorkspace } from './palette-contract.js'

/** What the action context is computed from: the session list, the workspace list and the theme. */
export interface PaletteContextInput {
  readonly sessions: readonly SessionSummary[]
  readonly workspaceItems: readonly Pick<WorkspaceView, 'workspaceId' | 'title' | 'sessionIds'>[]
  readonly archivedSessionIds: readonly string[]
  readonly pinnedSessionIds: readonly string[]
  readonly themePreference: PaletteThemePreference
}

/** The project a session belongs to: its own workspace, else the nearest parent's. */
const workspaceForSession = (
  session: SessionSummary | undefined,
  byId: Readonly<Record<string, SessionSummary>>,
  workspaceBySession: ReadonlyMap<string, WorkspaceId>,
): WorkspaceId | undefined => {
  let cursor = session?.id
  const visited = new Set<string>()
  while (cursor !== undefined && !visited.has(cursor)) {
    visited.add(cursor)
    const workspaceId = workspaceBySession.get(cursor)
    if (workspaceId !== undefined) return workspaceId
    cursor = byId[cursor]?.parentId
  }
  return undefined
}

/** The thread the main view shows; the New-thread screen holds a blank Session, which is not a thread. */
const mainViewSession = (sessions: readonly SessionSummary[]): SessionSummary | undefined => sessions.find(session => (session.retainedBy.mainView ?? 0) > 0)

/**
 * Where the user is, as palette actions see it: the thread on screen, its project, every project and the theme. The
 * palette computes it while it is open; a client tool computes the same from the stores' current snapshots.
 * @param input - the session list, workspace list and theme preference.
 * @returns the read-only action context.
 */
const of = (input: PaletteContextInput): PaletteActionContext => {
  const byId = Object.fromEntries(input.sessions.map(session => [session.id, session]))
  const workspaceBySession = new Map(input.workspaceItems.flatMap(workspace => workspace.sessionIds.map(id => [id, workspace.workspaceId] as const)))
  const onScreen = mainViewSession(input.sessions)
  const selected = onScreen?.blank === true ? undefined : onScreen
  const selectedWorkspaceId = workspaceForSession(selected, byId, workspaceBySession)
  const workspaces: PaletteWorkspace[] = input.workspaceItems.map(workspace => ({ id: workspace.workspaceId, title: workspace.title }))
  const workspace = selectedWorkspaceId === undefined ? null : (workspaces.find(candidate => candidate.id === selectedWorkspaceId) ?? null)
  return {
    thread:
      selected === undefined
        ? null
        : {
            id: selected.id,
            title: selected.displayTitle,
            cwd: selected.cwd ?? '',
            workspaceId: selectedWorkspaceId,
            pinned: input.pinnedSessionIds.includes(selected.id),
            archived: input.archivedSessionIds.includes(selected.id),
          },
    workspace,
    workspaces,
    themePreference: input.themePreference,
  }
}

export class PaletteContext {
  static readonly of = of
  static readonly workspaceForSession = workspaceForSession
  static readonly mainViewSession = mainViewSession
}
