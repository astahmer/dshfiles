/**
 * Send later as a row of the composer's More menu (fork fit of upstream xuusuwsn): the bar carries no Send later chip.
 * Picking the row sends a request to the Send later control mounted in that thread's composer, which opens its popover
 * from an invisible anchor. While the user pins the composer extras back into the bar, the control draws its button
 * instead. The same shape as prompt-stash's `composer-rows.ts`.
 */
const listeners = new Map<string, Set<() => void>>()

export class SendLaterRequests {
  static readonly send = (sessionId: string): void => {
    for (const listener of listeners.get(sessionId) ?? []) listener()
  }

  /** True while a Send later control is mounted for this thread (the setting is on and the composer is there). */
  static readonly available = (sessionId: string): boolean => (listeners.get(sessionId)?.size ?? 0) > 0

  static readonly on = (sessionId: string, listener: () => void): (() => void) => {
    const set = listeners.get(sessionId) ?? new Set()
    set.add(listener)
    listeners.set(sessionId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(sessionId)
    }
  }
}
