import type { ThreadOnScreenObservable } from '@dshfiles/workbench/thread-on-screen'

/**
 * The session the editor shows: the last thread on screen, kept while none is (a New-thread draft, a destination
 * page). Opening a file of another session shows that session, so the opened file is the one on screen.
 */
export const createFollowedSession = <SessionId extends string>(onScreen: ThreadOnScreenObservable<SessionId | undefined>) => {
  let current = onScreen.getSnapshot()
  const listeners = new Set<() => void>()
  const show = (sessionId: SessionId): void => {
    if (sessionId === current) return
    current = sessionId
    for (const listener of listeners) listener()
  }
  const follow = (): void => {
    const next = onScreen.getSnapshot()
    if (next !== undefined) show(next)
  }
  return {
    start: (): (() => void) => {
      follow()
      return onScreen.subscribe(follow)
    },
    get: (): SessionId | undefined => current,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    show,
  }
}
