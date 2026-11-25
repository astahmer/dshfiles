import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'

/** The part of a native `PendingApproval` this plugin reads: which call asks, and how the decision ends. */
export interface TrackedApproval {
  readonly callId: string | undefined
  readonly key: string
  readonly result: Promise<unknown>
}

/** What the tool row shows in place of its clock. */
export type ApprovalLineState = 'waiting' | 'rejected'

/**
 * Core's sentence for a rejected escalation, written for the model: `Error: the user rejected escalating this command
 * to "danger-full-access"; it stays denied, …`. Read from the settled result, so a reload still reads Rejected.
 */
const REJECTED_TEXT = /\bthe user (?:rejected|denied)\b/iu

const waiting = new Set<string>()
const tracked = new Set<string>()
const listeners = new Set<() => void>()
const notify = (): void => {
  for (const listener of [...listeners]) listener()
}

/**
 * Tool calls that wait on the user's approval (round four D3): the approval card reports its request here, and the
 * row's meta line reads "Waiting for approval" instead of a clock until the decision settles.
 */
export const ApprovalWaits = {
  /** Record a pending approval once per request; its call stops waiting when the decision (or a withdrawal) settles. */
  track(approval: TrackedApproval): void {
    const callId = approval.callId
    if (callId === undefined || tracked.has(approval.key)) return
    tracked.add(approval.key)
    waiting.add(callId)
    notify()
    const settle = (): void => {
      tracked.delete(approval.key)
      if (waiting.delete(callId)) notify()
    }
    approval.result.then(settle, settle)
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  isWaiting(callId: string): boolean {
    return waiting.has(callId)
  },

  /** The row's approval state: waiting while a decision is pending, rejected once core recorded the refusal. */
  stateOf(owner: ToolCallOwnerProps, isWaiting: boolean): ApprovalLineState | undefined {
    if (owner.phase !== 'result') return isWaiting ? 'waiting' : undefined
    const block = owner.block
    if (!block.isError) return undefined
    const text = block.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n')
    return REJECTED_TEXT.test(text) ? 'rejected' : undefined
  },
}
