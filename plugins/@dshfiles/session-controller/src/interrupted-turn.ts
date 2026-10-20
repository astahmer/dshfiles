import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

export const latestInterruptedTurn = (events: readonly SessionEvent[]): number | undefined => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/end') return event.data.reason.kind === 'interrupted' ? event.seq : undefined
    if (event.type === 'turn/start' || event.type === 'agent/inbox/spliced') return undefined
  }
  return undefined
}
