import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface SessionFocus {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => SessionId | undefined
  readonly dispose: () => void
}

/**
 * The panel owns the main slot, which unmounts the Session it should review, so
 * the on-screen Session is remembered from plugin setup: a component that
 * mounts after the switch would only ever see `undefined`.
 */
export const createSessionFocus = (mounted: ObservableSnapshot<SessionId | undefined>): SessionFocus => {
  let current = mounted.getSnapshot()
  const listeners = new Set<() => void>()
  const unsubscribe = mounted.subscribe(() => {
    const next = mounted.getSnapshot()
    if (next === undefined || next === current) return
    current = next
    for (const listener of listeners) listener()
  })
  return {
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => current,
    dispose: () => {
      listeners.clear()
      unsubscribe()
    },
  }
}
