export interface MainViewSessionReference {
  readonly blank: boolean
  readonly retainedBy: { readonly mainView?: number | undefined }
}

export const mainViewSessionId = <SessionId extends string>(input: {
  readonly ids: readonly SessionId[]
  readonly byId: Readonly<Record<SessionId, MainViewSessionReference | undefined>>
}): SessionId | undefined => {
  const blankSession = input.ids.find(id => {
    const session = input.byId[id]
    return session?.blank === true && (session.retainedBy.mainView ?? 0) > 0
  })
  if (blankSession !== undefined) return blankSession
  return input.ids.find(id => (input.byId[id]?.retainedBy.mainView ?? 0) > 0)
}
