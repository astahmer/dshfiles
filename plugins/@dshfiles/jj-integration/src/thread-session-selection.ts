/**
 * A workspace's `sessionIds` are newest-first and include the blank New-thread slots the app creates in it. Those
 * slots are not conversations: the native sidebar hides every blank Session except the one currently selected, so
 * neither a row's identity nor its activity may come from one. These helpers keep that rule in one place.
 */
export interface ThreadSessionReference {
  readonly blank: boolean
}

interface SelectionInput<Session extends ThreadSessionReference> {
  readonly sessionIds: readonly string[]
  readonly sessionById: ReadonlyMap<string, Session>
}

export class ThreadSessionSelection {
  /** The newest session with a real conversation; a blank slot only answers when the workspace has nothing else. */
  static readonly mainSessionOf = <Session extends ThreadSessionReference>(input: SelectionInput<Session>): Session | undefined => {
    let blank: Session | undefined
    for (const sessionId of input.sessionIds) {
      const session = input.sessionById.get(sessionId)
      if (session === undefined) continue
      if (!session.blank) return session
      blank ??= session
    }
    return blank
  }

  /**
   * The sessions a row may list as its history: blank New-thread slots stay out of it. An id the client cannot read is
   * kept so the row still names the session it could not open.
   */
  static readonly visibleSessionIdsOf = (input: SelectionInput<ThreadSessionReference>): readonly string[] =>
    input.sessionIds.filter(sessionId => input.sessionById.get(sessionId)?.blank !== true)

  /**
   * A workspace nobody ever opened and that holds no work: a leftover jj registration or an empty folder. An unreadable
   * session is not blank, so a row whose sessions could not be read stays visible instead of disappearing.
   */
  static readonly isUnusedThread = (input: {
    readonly sessionIds: readonly string[]
    readonly pendingRevisions: number
    readonly sessionById: ReadonlyMap<string, ThreadSessionReference | undefined>
  }): boolean =>
    input.pendingRevisions === 0 && (input.sessionIds.length === 0 || input.sessionIds.every(sessionId => input.sessionById.get(sessionId)?.blank === true))
}
