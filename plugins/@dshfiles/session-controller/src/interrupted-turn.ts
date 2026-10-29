import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session/types'

/**
 * A turn worth resuming: the Host process cut it off (crash repair closes it as `interrupted`, a graceful shutdown
 * aborts it as `disposed`), its model request failed after the retries (upstream outage, rate limit, transport), or a
 * reply hit the output-token cap and was cut off mid-answer.
 * A user's own stop and a signed-out account are not: resuming them would only repeat the stop.
 */
const endedResumably = (reason: TurnEndReason): boolean => {
  if (reason.kind === 'interrupted' || reason.kind === 'max-tokens') return true
  if (reason.kind === 'aborted') return reason.reason.kind === 'disposed'
  if (reason.kind === 'error') return reason.error.code !== 'ACCOUNT_SIGNED_OUT'
  return false
}

/** A turn that stopped before the model replied can run its request again, including once a signed-out account signs in. */
const endedRetryably = (reason: TurnEndReason): boolean =>
  reason.kind === 'interrupted' || reason.kind === 'error' || (reason.kind === 'aborted' && reason.reason.kind === 'disposed')

/** Whether the turn ending at `endIndex` recorded any model reply or tool call; a failed attempt records neither. */
const producedReply = (events: readonly SessionEvent[], endIndex: number): boolean => {
  for (let index = endIndex - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/start') return false
    if (event.type === 'assistant/message' || event.type === 'tool/call') return true
  }
  return false
}

/**
 * `retry` runs a turn that produced nothing again without a visible prompt; `resume` asks the model to continue a turn
 * that was cut off after it started answering.
 */
export interface StoppedTurn {
  readonly seq: number
  readonly action: 'resume' | 'retry'
}

export const latestStoppedTurn = (events: readonly SessionEvent[]): StoppedTurn | undefined => {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type === 'turn/end') {
      const reason = event.data.reason
      if (endedRetryably(reason) && !producedReply(events, index)) return { seq: event.seq, action: 'retry' }
      return endedResumably(reason) ? { seq: event.seq, action: 'resume' } : undefined
    }
    if (event.type === 'turn/start' || event.type === 'agent/inbox/spliced') return undefined
  }
  return undefined
}

export const latestInterruptedTurn = (events: readonly SessionEvent[]): number | undefined => {
  const stopped = latestStoppedTurn(events)
  return stopped?.action === 'resume' ? stopped.seq : undefined
}
