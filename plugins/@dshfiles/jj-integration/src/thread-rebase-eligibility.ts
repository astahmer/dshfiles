interface UserQuestionProjectionValues {
  readonly userQuestions?: { readonly active: readonly unknown[] }
}

export interface ThreadSessionActivity {
  readonly running: boolean | undefined
  readonly pendingUserQuestion: boolean | undefined
}

export const hasPendingUserQuestion = (projectionValues: UserQuestionProjectionValues | undefined): boolean | undefined => {
  const userQuestions = projectionValues?.userQuestions
  return userQuestions === undefined ? undefined : userQuestions.active.length > 0
}

export const canRebaseThread = (sessionIds: readonly string[], getActivity: (sessionId: string) => ThreadSessionActivity | undefined): boolean | undefined => {
  let hasUnknownActivity = false
  for (const sessionId of sessionIds) {
    const activity = getActivity(sessionId)
    if (activity?.running === true || activity?.pendingUserQuestion === true) return false
    if (activity?.running === undefined || activity.pendingUserQuestion === undefined) hasUnknownActivity = true
  }
  return hasUnknownActivity ? undefined : true
}

export const canRebaseThreadIfKnown = (
  sessionIds: readonly string[],
  activity: ReadonlyMap<string, ThreadSessionActivity> | undefined,
): boolean | undefined => {
  if (sessionIds.length === 0) return true
  if (activity === undefined) return undefined
  return canRebaseThread(sessionIds, sessionId => activity.get(sessionId))
}

/**
 * Session ids the rebase guard must check. An agent rebasing its own thread is
 * the caller of that rebase, so its in-flight session is exempt — otherwise a
 * self-rebase could never pass its own guard. Every other session of the
 * workspace still has to be idle and free of pending questions, and the UI and
 * `/rebase` paths keep the caller in scope so a rebase stays refused while a
 * session works.
 */
export const rebaseGuardSessionIds = (input: {
  readonly sessionIds: readonly string[]
  readonly fromAgent: boolean
  readonly sessionId: string | undefined
}): readonly string[] => {
  if (!input.fromAgent || input.sessionId === undefined) return input.sessionIds
  return input.sessionIds.filter(sessionId => sessionId !== input.sessionId)
}

/**
 * One answer to "may this thread be rebased", shared by the guard that refuses a
 * rebase and by the status an Agent reads before asking for one. Both apply the
 * same caller exemption, so `jj_thread_status` reports what a rebase would do
 * instead of counting the asking Agent's own turn against it.
 */
export const threadRebaseEligibility = (input: {
  readonly sessionIds: readonly string[]
  readonly activity: ReadonlyMap<string, ThreadSessionActivity> | undefined
  readonly fromAgent: boolean
  readonly sessionId: string | undefined
}): boolean | undefined =>
  canRebaseThreadIfKnown(rebaseGuardSessionIds({ sessionIds: input.sessionIds, fromAgent: input.fromAgent, sessionId: input.sessionId }), input.activity)

export const canRebaseFromClientSnapshot = (input: {
  readonly threadSessionsEligible: boolean | undefined
  readonly sessionRunning: boolean
  readonly questionPending: boolean
}): boolean => input.threadSessionsEligible === true && !input.sessionRunning && !input.questionPending
