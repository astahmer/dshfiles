import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session/types'

/**
 * A turn the Host process cut off: crash repair closes it as `interrupted` when the log is next opened, and a
 * graceful shutdown ends it as aborted because the Agent was disposed. A user's own stop (`aborted` by `user`) is not.
 */
const endedByHostExit = (reason: TurnEndReason): boolean => reason.kind === 'interrupted' || (reason.kind === 'aborted' && reason.reason.kind === 'disposed')

export const latestInterruptedTurn = (events: readonly SessionEvent[]): number | undefined => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/end') return endedByHostExit(event.data.reason) ? event.seq : undefined
    if (event.type === 'turn/start' || event.type === 'agent/inbox/spliced') return undefined
  }
  return undefined
}
