import { describe, expect, test } from 'vitest'

import { isRetryId, retryNotice } from './retry-notice.js'
import type { RetryId } from '@deepseek-ai/dsh-llm-retry'

const labels: Record<string, string> = {
  'opencode-go-alex': 'OpenCode Go Alex',
  'opencode-go_mathias': 'OpenCode Go Mathias',
}
const label = (accountId: string): string => labels[accountId] ?? accountId

const retryId = (value: string): RetryId => {
  if (!isRetryId(value)) throw new Error(`not a retry id: ${value}`)
  return value
}

const failure = { message: 'pi-ai stream idle timeout after 300000ms', code: 'TIMEOUT' } as const

const failover = retryNotice(
  {
    kind: 'retry',
    step: { kind: 'failover', to: 'opencode-go_mathias' },
    failureKind: 'transport',
    account: 'opencode-go-alex',
    attempt: 1,
    plannedAttempts: 5,
    retryId: 'retry-1',
  },
  { retryId: retryId('retry-1'), turn: 8, step: 2, provider: 'opencode-go-alex', failure, label },
)

describe('the llm/retry rows ai-accounts writes', () => {
  test('name the provider the request header opened with, never the fail-over target', () => {
    // DSH refuses a stored log whose llm/retry row disagrees with its request/header, and one
    // refused log fails every session-content search, so this field is a compatibility contract.
    expect(failover.provider).toBe('opencode-go-alex')
    expect(failover.provider).not.toBe('opencode-go_mathias')
  })

  test('keep the fail-over visible in the message and its own code', () => {
    expect(failover.failure).toEqual({
      message: 'Switched from OpenCode Go Alex to OpenCode Go Mathias after: pi-ai stream idle timeout after 300000ms',
      code: 'ACCOUNT_FAILOVER',
    })
    expect(failover.policyKey).toBe('ai-accounts:transport')
    expect(failover.retry).toBe(1)
    expect(failover.maxRetries).toBe(5)
    expect(failover.delayMs).toBe(0)
  })

  test('keep turn, step and retry coordinates the validator pairs with retry-started', () => {
    expect({ turn: failover.turn, step: failover.step, retryId: failover.retryId }).toEqual({ turn: 8, step: 2, retryId: 'retry-1' })
    const started = { retryId: failover.retryId, turn: failover.turn, step: failover.step, retry: failover.retry }
    expect(started).toEqual({ retryId: 'retry-1', turn: 8, step: 2, retry: 1 })
  })

  test('carry the wait delay of a rung that backs off before retrying', () => {
    const waited = retryNotice(
      {
        kind: 'retry',
        step: { kind: 'wait', delayMs: 1_000 },
        failureKind: 'rateLimit',
        account: 'codex-work',
        attempt: 2,
        plannedAttempts: 3,
        retryId: 'retry-2',
      },
      { retryId: retryId('retry-2'), turn: 1, step: 0, provider: 'codex-work', failure, label },
    )
    expect(waited.delayMs).toBe(1_000)
    expect(waited.provider).toBe('codex-work')
    expect(waited.failure.code).toBe('TIMEOUT')
  })
})
