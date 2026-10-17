import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import type { LlmRetryEventData, RetryId } from '@deepseek-ai/dsh-llm-retry'

import type { RecoveryAction } from './failure-recovery.js'

const NOTICE_MESSAGE_CHARS = 400

/** `RetryId` is an unvalidated brand; this narrowing keeps llm-retry a type-only import. */
export const isRetryId = (id: string): id is RetryId => id.length > 0

/**
 * One `llm/retry` row per rung, under this plugin's own policy key so DSH's
 * retry counter never mistakes it for its own. A switch of account, model or
 * request carries its own code so the chat row shows what changed instead of
 * the generic quota or auth text the original code maps to.
 *
 * `provider` is the provider of the **open request header**, never the account
 * the ladder moved to: DSH validates a stored log by requiring every
 * `llm/retry` row to name the provider its `request/header` opened with
 * (`session-format-v3-to-v4`, "llm/retry provider does not match the open
 * request/header"). A row that names a fail-over target makes the whole log
 * unreadable, and one unreadable log fails every session-content search.
 */
export const retryNotice = (
  action: Extract<RecoveryAction, { kind: 'retry' }>,
  context: {
    readonly retryId: RetryId
    readonly turn: number
    readonly step: number
    readonly provider: string
    readonly failure: LlmFailure
    readonly label: (accountId: string) => string
  },
): Extract<LlmRetryEventData, { mode: 'normal' }> => {
  const from = context.label(action.account)
  const cause = context.failure.message.slice(0, NOTICE_MESSAGE_CHARS)
  const step = action.step
  let failure: LlmFailure = { ...context.failure, message: `${from}: ${cause}` }
  if (step.kind === 'failover') failure = { message: `Switched from ${from} to ${context.label(step.to)} after: ${cause}`, code: 'ACCOUNT_FAILOVER' }
  if (step.kind === 'luna-reserve') failure = { message: `Continuing ${from} on Luna Reserve after: ${cause}`, code: 'LUNA_RESERVE' }
  if (step.kind === 'shrink') failure = { message: `Retrying ${from} with earlier images as file placeholders after: ${cause}`, code: 'REQUEST_SHRUNK' }
  return {
    retryId: context.retryId,
    turn: context.turn,
    step: context.step,
    provider: context.provider,
    mode: 'normal',
    policyKey: `ai-accounts:${action.failureKind}`,
    retry: action.attempt,
    maxRetries: action.plannedAttempts,
    delayMs: step.kind === 'retry' || step.kind === 'wait' ? step.delayMs : 0,
    failure,
  }
}
