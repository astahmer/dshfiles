import { z } from 'zod'

const sessionProjectionValuesSchema = z.object({ userQuestions: z.object({ active: z.array(z.unknown()) }).passthrough() }).passthrough()

export interface ThreadSessionActivity {
  readonly running: boolean | undefined
  readonly pendingUserQuestion: boolean | undefined
}

export const hasPendingUserQuestion = (projectionValues: unknown): boolean | undefined => {
  if (projectionValues === undefined) return undefined
  const parsed = sessionProjectionValuesSchema.safeParse(projectionValues)
  return parsed.success ? parsed.data.userQuestions.active.length > 0 : undefined
}

export const canRebaseThread = (sessionIds: readonly string[], getActivity: (sessionId: string) => ThreadSessionActivity | undefined): boolean =>
  sessionIds.every(sessionId => {
    const activity = getActivity(sessionId)
    return activity?.running === false && activity.pendingUserQuestion === false
  })
