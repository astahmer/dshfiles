import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import * as Schema from 'effect/Schema'
import { threadWorkspaceName } from '@dshfiles/jj-integration/api'
import { type ThreadDirectories, WorkspacePaths, workspaceName } from './workspace-paths.js'

/**
 * An empty draft thread: a Session that never got a first prompt. The Host titles a thread only after its first turn
 * (or a rename), so a Session with no durable title and not running is one DSH created for a New thread and abandoned.
 * DSH itself shows only the selected blank one, so these stay invisible everywhere else; a sidebar that lists them
 * turns every abandoned attempt into a permanent row named after its folder.
 *
 * A missing title is not evidence on its own: it is also what a row looks like before its projections arrive (a
 * reconnect, a failed list pull). Only the Host's prompted-turn count of zero proves the thread was never prompted;
 * an unknown count leaves the row where it is. (`promptedTurnCount` is jj-integration's list projection; without it
 * no thread is a draft, the safe direction.)
 */
type DraftThreadSession = Pick<SessionSummary, 'id' | 'title' | 'running' | 'blank'> & {
  readonly projectionValues?: object | undefined
}

const neverPrompted = Schema.is(Schema.Struct({ promptedTurnCount: Schema.Literal(0) }))

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

/** A `thread-…` folder in a project's thread directory is a disposable workspace provisioned for one thread. */
const isThreadWorkspacePath = (input: { readonly path: string; readonly threadDirectories: ThreadDirectories | undefined }): boolean =>
  WorkspacePaths.isJjWorkspace(input) && Schema.is(threadWorkspaceName)(workspaceName(input.path))

export class DraftThreadsModel {
  /** A thread the user never prompted, so it carries no title and no history worth a row. */
  static readonly isDraftThread = (session: DraftThreadSession): boolean =>
    !session.blank && !session.running && (session.title ?? '').trim() === '' && neverPrompted(session.projectionValues)

  /**
   * The confirmed ids that still qualify when the user confirms: a draft prompted, titled or removed since the
   * dialog opened is skipped.
   */
  static readonly stillDraftIds = (input: {
    readonly confirmed: readonly SessionId[]
    readonly sessions: readonly DraftThreadSession[]
  }): readonly SessionId[] => {
    const current = new Map(input.sessions.map(session => [session.id, session]))
    return input.confirmed.filter(sessionId => {
      const session = current.get(sessionId)
      return session !== undefined && DraftThreadsModel.isDraftThread(session)
    })
  }

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
    readonly threadDirectories?: ThreadDirectories | undefined
  }): DraftCleanupPlan => {
    const draftIds = new Set(input.drafts.map(draft => draft.id))
    const workspacePaths = input.workspaces
      .filter(workspace => isThreadWorkspacePath({ path: workspace.path, threadDirectories: input.threadDirectories }))
      .filter(workspace => workspace.sessionIds.length > 0 && workspace.sessionIds.every(sessionId => draftIds.has(sessionId)))
      .map(workspace => workspace.path)
    return { sessionIds: input.drafts.map(draft => draft.id), workspacePaths }
  }
}
