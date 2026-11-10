/**
 * One resume path for every "needs you" row, whatever stopped it. The list offers a group-wide Resume all on every
 * group whose rows carry the verb, so a mixed group (a quota stop beside a crash-interrupted turn) still resumes in one
 * click: the routing lives here instead of in the click handler, so tests cover each combination.
 */
import type { InboxThreadSignal, ThreadStatus } from './thread-status.js'
import type { QuotaContinuation } from './usage-limit-rows.js'

export type ResumeTarget =
  | { readonly kind: 'inbox'; readonly itemId: string }
  | { readonly kind: 'quota'; readonly continuationId: string }
  | { readonly kind: 'recovery'; readonly sessionId: string }

/**
 * Where a row resumes from: its inbox item when the provider offers Resume (the same verb the Inbox page runs), the
 * stored quota continuation when the inbox plugin is absent, and the recovery store for an interrupted turn.
 */
const targetOf = (input: {
  readonly sessionId: string
  readonly signal: InboxThreadSignal | undefined
  readonly continuation: QuotaContinuation | undefined
}): ResumeTarget => {
  if (input.signal !== undefined && input.signal.verb === 'Resume') return { kind: 'inbox', itemId: input.signal.itemId }
  if (input.continuation !== undefined) return { kind: 'quota', continuationId: input.continuation.continuationId }
  return { kind: 'recovery', sessionId: input.sessionId }
}

/** The rows of one group a group-wide Resume all may act on; empty when the group offers nothing to resume. */
const resumableRowsOf = <Thread>(input: {
  readonly rows: readonly Thread[]
  readonly statusOf: (thread: Thread) => ThreadStatus | undefined
}): readonly Thread[] => input.rows.filter(row => input.statusOf(row)?.verb === 'Resume')

export class ResumeAttentionModel {
  static readonly targetOf = targetOf
  static readonly resumableRowsOf = resumableRowsOf
}
