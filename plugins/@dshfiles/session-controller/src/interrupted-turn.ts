import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session/types'

/**
 * A turn worth resuming: the Host process cut it off (crash repair closes it as `interrupted`, a graceful shutdown
 * aborts it as `disposed`), or its model request failed after the retries (upstream outage, rate limit, transport).
 * A user's own stop and a signed-out account are not: resuming them would only repeat the stop.
 */
const endedResumably = (reason: TurnEndReason): boolean => {
  if (reason.kind === 'interrupted') return true
  if (reason.kind === 'aborted') return reason.reason.kind === 'disposed'
  if (reason.kind === 'error') return reason.error.code !== 'ACCOUNT_SIGNED_OUT'
  return false
}

export const latestInterruptedTurn = (events: readonly SessionEvent[]): number | undefined => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/end') return endedResumably(event.data.reason) ? event.seq : undefined
    if (event.type === 'turn/start' || event.type === 'agent/inbox/spliced') return undefined
  }
  return undefined
}
