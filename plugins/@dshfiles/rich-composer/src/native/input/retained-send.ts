interface SessionRetention<Session extends { readonly sessionId: string }> {
  binding(sessionId: Session['sessionId']): { readonly session: Session } | undefined
  retain(
    sessionId: Session['sessionId'],
    options: { readonly source: 'controllerOperation' },
  ): { release(): void }
}

export const whileSessionRetained = async <Session extends { readonly sessionId: string }, Result>(input: {
  readonly sessions: SessionRetention<Session>
  readonly session: Session
  readonly operation: () => Promise<Result>
}): Promise<Result> => {
  if (input.sessions.binding(input.session.sessionId)?.session !== input.session) {
    throw new Error('conversation.input.send: Session binding was replaced before admission')
  }
  const reference = input.sessions.retain(input.session.sessionId, { source: 'controllerOperation' })
  try {
    return await input.operation()
  } finally {
    reference.release()
  }
}
