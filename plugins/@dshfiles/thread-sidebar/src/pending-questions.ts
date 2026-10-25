type SessionQuestionSummary = {
  readonly projectionValues?: {
    readonly title?: string | null
    readonly userQuestions?: {
      readonly active: readonly unknown[]
    }
  }
}

export const activeQuestionSessionIds = <SessionId extends string>(
  candidateSessionIds: readonly SessionId[],
  summaries: Readonly<Partial<Record<SessionId, SessionQuestionSummary>>>,
): readonly SessionId[] => candidateSessionIds.filter(sessionId => (summaries[sessionId]?.projectionValues?.userQuestions?.active.length ?? 0) > 0)
