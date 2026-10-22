/**
 * Which Session a New thread asks the Host for.
 *
 * A New thread with draft options reuses its Workspace's first listed blank
 * (upstream behaviour); one without draft options always gets a fresh Session,
 * so no blank identity is named. Extracted from the fork's navigation delta so
 * the choice is testable without a Client runtime.
 */

/** One listed Session, as the choice reads it. */
export interface NewThreadCandidate<SessionIdType extends string> {
  readonly id: SessionIdType
  readonly blank: boolean
  readonly cwd?: string | undefined
}

/** Everything the choice reads from the two Controller snapshots. */
export interface NewThreadPlan<WorkspaceIdType extends string, SessionIdType extends string> {
  readonly workspaceId: WorkspaceIdType
  readonly workspacePath: string
  readonly workspaceSessionIds: readonly SessionIdType[]
  readonly archivedSessionIds: readonly SessionIdType[]
  /** Host list order; the first reusable blank wins, as upstream. */
  readonly candidates: readonly NewThreadCandidate<SessionIdType>[]
  /** Absent when the New thread carries no draft options. */
  readonly reuse: boolean
  readonly agentPreset?: string | undefined
}

/** The `session/create` request one New thread sends. */
export interface NewThreadRequest<WorkspaceIdType extends string, SessionIdType extends string> {
  workspaceId: WorkspaceIdType
  sessionId?: SessionIdType
  agentPreset?: string
}

/**
 * Choose the Session a New thread creates or reuses.
 * @param plan - Workspace membership, the archived set and the listed Sessions.
 * @returns the workspace plus the blank to reuse, when draft options allow one.
 */
export const newThreadRequest = <WorkspaceIdType extends string, SessionIdType extends string>(
  plan: NewThreadPlan<WorkspaceIdType, SessionIdType>,
): NewThreadRequest<WorkspaceIdType, SessionIdType> => {
  const reusable = plan.reuse
    ? plan.candidates.find(
        candidate =>
          candidate.blank &&
          candidate.cwd === plan.workspacePath &&
          plan.workspaceSessionIds.includes(candidate.id) &&
          !plan.archivedSessionIds.includes(candidate.id),
      )
    : undefined
  const request: NewThreadRequest<WorkspaceIdType, SessionIdType> = { workspaceId: plan.workspaceId }
  if (reusable !== undefined) request.sessionId = reusable.id
  if (plan.agentPreset !== undefined) request.agentPreset = plan.agentPreset
  return request
}
