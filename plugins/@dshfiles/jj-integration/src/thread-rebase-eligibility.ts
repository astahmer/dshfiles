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

export const canRebaseThread = (sessionIds: readonly string[], getActivity: (sessionId: string) => ThreadSessionActivity | undefined): boolean =>
  sessionIds.every(sessionId => {
    const activity = getActivity(sessionId)
    return activity?.running === false && activity.pendingUserQuestion === false
  })

export const canRebaseThreadIfKnown = (
  sessionIds: readonly string[],
  activity: ReadonlyMap<string, ThreadSessionActivity> | undefined,
): boolean | undefined => {
  if (sessionIds.length === 0) return true
  if (activity === undefined) return undefined
  return canRebaseThread(sessionIds, sessionId => activity.get(sessionId))
}

export const canRebaseFromClientSnapshot = (input: {
  readonly threadSessionsEligible: boolean
  readonly sessionRunning: boolean
  readonly questionPending: boolean
}): boolean => input.threadSessionsEligible && !input.sessionRunning && !input.questionPending
