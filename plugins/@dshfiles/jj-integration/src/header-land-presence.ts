/**
 * Which threads show a header Land right now. Each mounted header Land marks its thread while it shows; another view of
 * the same thread (diffs-review's land card) reads it and draws its own Land as a secondary button, so a screen has one
 * primary Land.
 */
export interface HeaderLandPresence {
  /** Marks the thread until the returned function runs; two marks of one thread count separately. */
  readonly mark: (sessionId: string) => () => void
  readonly shown: (sessionId: string) => boolean
  readonly subscribe: (listener: () => void) => () => void
}

export const createHeaderLandPresence = (): HeaderLandPresence => {
  const counts = new Map<string, number>()
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  return {
    mark: sessionId => {
      counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1)
      notify()
      let marked = true
      return () => {
        if (!marked) return
        marked = false
        const left = (counts.get(sessionId) ?? 1) - 1
        if (left > 0) counts.set(sessionId, left)
        else counts.delete(sessionId)
        notify()
      }
    },
    shown: sessionId => (counts.get(sessionId) ?? 0) > 0,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
