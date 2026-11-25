/**
 * The agent a person picked in a new thread's chip, by Session id, until that thread's first send. One page-wide map:
 * the chip writes it, the send preparer reads and clears it. A pick is presentation state of one draft, so it is not
 * persisted and has no agent tool; the decision it leads to is recorded on the Host at send.
 */
const picks = new Map<string, string>()
const listeners = new Set<() => void>()

const publish = (): void => {
  for (const listener of listeners) listener()
}

export const ComposerAgentChoices = {
  get: (sessionId: string): string | null => picks.get(sessionId) ?? null,
  /** Pick an agent for one new thread; null goes back to the project default. */
  set: (sessionId: string, handle: string | null): void => {
    if ((picks.get(sessionId) ?? null) === handle) return
    if (handle === null) picks.delete(sessionId)
    else picks.set(sessionId, handle)
    publish()
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
