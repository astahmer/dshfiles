export interface ThreadOnScreenObservable<T> {
  readonly getSnapshot: () => T
  readonly subscribe: (listener: () => void) => () => void
}

/** The slice of `@dshfiles/session-controller`'s `ctx.sessionDrafts` this reads, without depending on it. */
export interface SessionDraftsOwner {
  readonly list: ThreadOnScreenObservable<Readonly<Record<string, { readonly local: boolean }>>>
}

/**
 * The thread whose panels follow the screen: the session mounted beside the conversation, except a New-thread draft
 * the Host has not created yet (its files, changes and costs cannot be read). It reads as no thread until the draft
 * is sent, then as that thread. Subscribers hear only a change of that thread, not every draft keystroke.
 */
export const threadOnScreen = <SessionId extends string>(options: {
  readonly mounted: ThreadOnScreenObservable<SessionId | undefined>
  readonly sessionDrafts: () => SessionDraftsOwner | undefined
}): ThreadOnScreenObservable<SessionId | undefined> => {
  const getSnapshot = (): SessionId | undefined => {
    const mounted = options.mounted.getSnapshot()
    if (mounted === undefined) return undefined
    return options.sessionDrafts()?.list.getSnapshot()[mounted]?.local === true ? undefined : mounted
  }
  const subscribe = (listener: () => void): (() => void) => {
    let last = getSnapshot()
    let watchedList: SessionDraftsOwner['list'] | undefined
    let stopDrafts: (() => void) | undefined
    const notify = (): void => {
      const next = getSnapshot()
      if (next === last) return
      last = next
      listener()
    }
    // The drafts owner may start after this subscriber; a draft mounting notifies here first, so the list is attached then.
    const attachDrafts = (): void => {
      const list = options.sessionDrafts()?.list
      if (list === watchedList) return
      stopDrafts?.()
      watchedList = list
      stopDrafts = list?.subscribe(notify)
    }
    attachDrafts()
    const stopMounted = options.mounted.subscribe(() => {
      attachDrafts()
      notify()
    })
    return () => {
      stopMounted()
      stopDrafts?.()
    }
  }
  return { getSnapshot, subscribe }
}
