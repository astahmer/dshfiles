/**
 * Lands asked for from outside the thread header (the thread list's row verb, Inbox › Waiting threads). Each request
 * opens the header's own confirmation for that thread; nothing lands until the user confirms there. One request shows
 * at a time: a newer one replaces it, and the one on screen ends when its dialog, its land and its report are done.
 */
export interface LandRequest {
  readonly sessionId: string
  /** Tells two requests for one thread apart, so asking again reopens a dialog the user already closed. */
  readonly sequence: number
}

export interface LandRequests {
  readonly request: (sessionId: string) => void
  readonly current: () => LandRequest | null
  /** Ends the request with this sequence; a newer request stays. */
  readonly finish: (sequence: number) => void
  readonly subscribe: (listener: () => void) => () => void
}

export const createLandRequests = (): LandRequests => {
  let current: LandRequest | null = null
  let sequence = 0
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }
  return {
    request: sessionId => {
      sequence += 1
      current = { sessionId, sequence }
      notify()
    },
    current: () => current,
    finish: finished => {
      if (current?.sequence !== finished) return
      current = null
      notify()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
