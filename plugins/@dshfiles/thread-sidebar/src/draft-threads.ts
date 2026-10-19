import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { threadWorkspaceName } from '@dshfiles/jj-integration/api'

/**
 * An empty draft thread: a Session that never got a first prompt. The Host titles a thread only after its first turn
 * (or a rename), so a Session with no durable title and not running is one DSH created for a New thread and abandoned.
 * DSH itself shows only the selected blank one, so these stay invisible everywhere else; a sidebar that lists them
 * turns every abandoned attempt into a permanent row named after its folder.
 */
type DraftThreadSession = Pick<SessionSummary, 'id' | 'title' | 'running' | 'blank'>

interface ThreadWorkspaceRef {
  readonly path: string
  readonly sessionIds: readonly SessionId[]
}

interface DraftThreadExclusions {
  readonly archivedSessionIds: ReadonlySet<string>
  readonly pinnedSessionIds: ReadonlySet<string>
  readonly selectedSessionId: string | undefined
}

interface DraftCleanupPlan {
  readonly sessionIds: readonly SessionId[]
  /** Thread workspaces that hold nothing but empty drafts; a folder shared with a real thread is kept. */
  readonly workspacePaths: readonly string[]
}

/** Paths of `<repository>-threads/<thread-…>` are the disposable workspaces jj-integration provisions per thread. */
const THREADS_DIRECTORY_SUFFIX = '-threads'

const isThreadWorkspacePath = (path: string): boolean => {
  const segments = path.split('/')
  const name = segments.at(-1)
  const parent = segments.at(-2)
  return name !== undefined && parent !== undefined && parent.endsWith(THREADS_DIRECTORY_SUFFIX) && threadWorkspaceName.safeParse(name).success
}

export class DraftThreadsModel {
  /** A thread the user never prompted, so it carries no title and no history worth a row. */
  static readonly isDraftThread = (session: DraftThreadSession): boolean => !session.blank && !session.running && (session.title ?? '').trim() === ''

  /** Empty drafts the sidebar may fold away; archived, pinned and the open thread stay where the user put them. */
  static readonly draftThreadsOf = <Session extends DraftThreadSession>(input: {
    readonly sessions: readonly Session[]
    readonly exclusions: DraftThreadExclusions
  }): readonly Session[] =>
    input.sessions.filter(
      session =>
        DraftThreadsModel.isDraftThread(session) &&
        !input.exclusions.archivedSessionIds.has(session.id) &&
        !input.exclusions.pinnedSessionIds.has(session.id) &&
        session.id !== input.exclusions.selectedSessionId,
    )

  /**
   * What "Clean up" may remove: every draft Session is archived, and a thread workspace is forgotten only when every
   * Session accounted to it is one of those drafts. jj-integration still refuses a workspace with unlanded revisions or
   * uncommitted edits, so a workspace that turns out to hold work stays.
   */
  static readonly planCleanup = (input: {
    readonly drafts: readonly DraftThreadSession[]
    readonly workspaces: readonly ThreadWorkspaceRef[]
  }): DraftCleanupPlan => {
    const draftIds = new Set(input.drafts.map(draft => draft.id))
    const workspacePaths = input.workspaces
      .filter(workspace => isThreadWorkspacePath(workspace.path))
      .filter(workspace => workspace.sessionIds.length > 0 && workspace.sessionIds.every(sessionId => draftIds.has(sessionId)))
      .map(workspace => workspace.path)
    return { sessionIds: input.drafts.map(draft => draft.id), workspacePaths }
  }
}
