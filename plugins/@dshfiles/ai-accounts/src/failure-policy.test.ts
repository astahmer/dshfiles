import { describe, expect, it } from 'vitest'
import { DEFAULT_RECOVERY_POLICY, NO_PROGRESS, decideRecovery, recoveryPolicySchema, type KindPolicy, type RecoveryProgress } from './failure-policy.js'

const climb = (input: {
  readonly policy: KindPolicy
  readonly retryAfterMs?: number
  readonly lunaReserveAvailable?: boolean
  readonly failoverTargets?: readonly string[]
  readonly canShrink?: boolean
}) => {
  const targets = [...(input.failoverTargets ?? [])]
  const steps: string[] = []
  let progress: RecoveryProgress = NO_PROGRESS
  for (let guard = 0; guard < 30; guard += 1) {
    const decision = decideRecovery({
      policy: input.policy,
      progress,
      retryAfterMs: input.retryAfterMs,
      lunaReserveAvailable: input.lunaReserveAvailable === true && !progress.lunaReserve,
      failoverTo: targets[0],
      canShrink: input.canShrink === true,
    })
    progress = decision.progress
    const step = decision.step
    if (step.kind === 'failover') targets.shift()
    if (step.kind === 'retry' || step.kind === 'wait') steps.push(`${step.kind}:${String(step.delayMs)}`)
    else if (step.kind === 'failover') steps.push(`failover:${step.to}`)
    else if (step.kind === 'give-up') steps.push(`give-up:${step.then}`)
    else steps.push(step.kind)
    if (step.kind === 'give-up') return steps
  }
  throw new Error('policy never gave up')
}

describe('decideRecovery', () => {
  it('retries a transport failure with doubling backoff, fails over, retries the stand-in, then fails', () => {
    expect(climb({ policy: DEFAULT_RECOVERY_POLICY.transport, failoverTargets: ['codex_work'] })).toEqual([
      'retry:1000',
      'retry:2000',
      'failover:codex_work',
      'retry:1000',
      'retry:2000',
      'give-up:fail',
    ])
  })

  it('fails a rate limit over first, then waits out a declared reset once', () => {
    expect(climb({ policy: DEFAULT_RECOVERY_POLICY.rateLimit, retryAfterMs: 20_000, failoverTargets: ['codex_work'] })).toEqual([
      'failover:codex_work',
      'wait:20000',
      'give-up:fail',
    ])
  })

  it('skips the wait when the provider reset is further away than the policy allows', () => {
    expect(climb({ policy: DEFAULT_RECOVERY_POLICY.rateLimit, retryAfterMs: 10 * 60_000 })).toEqual(['give-up:fail'])
  })

  it('sends an exhausted account to Luna Reserve before failing over', () => {
    expect(climb({ policy: DEFAULT_RECOVERY_POLICY.exhausted, lunaReserveAvailable: true, failoverTargets: ['codex_work'] })).toEqual([
      'luna-reserve',
      'failover:codex_work',
      'give-up:fail',
    ])
  })

  it('leaves auth and oversized failures to DSH by default', () => {
    expect(climb({ policy: DEFAULT_RECOVERY_POLICY.auth, failoverTargets: ['codex_work'] })).toEqual(['give-up:dsh'])
    expect(climb({ policy: DEFAULT_RECOVERY_POLICY.oversized, canShrink: true })).toEqual(['give-up:dsh'])
  })

  it('shrinks once before the last try only when something can be shrunk', () => {
    const policy = { ...DEFAULT_RECOVERY_POLICY.oversized, shrink: true, then: 'fail' as const }
    expect(climb({ policy, canShrink: true })).toEqual(['shrink', 'give-up:fail'])
    expect(climb({ policy, canShrink: false })).toEqual(['give-up:fail'])
  })

  it('honors a provider retry-after longer than the backoff', () => {
    expect(climb({ policy: { ...DEFAULT_RECOVERY_POLICY.transport, retries: 1, failover: false }, retryAfterMs: 7_000 })).toEqual([
      'retry:7000',
      'give-up:fail',
    ])
  })
})

describe('recoveryPolicySchema', () => {
  it('fills defaults for settings written before failure recovery existed', () => {
    expect(recoveryPolicySchema.parse(undefined)).toEqual(DEFAULT_RECOVERY_POLICY)
    expect(recoveryPolicySchema.parse({ transport: { retries: 4 }, rateLimit: 'garbage' })).toEqual({
      ...DEFAULT_RECOVERY_POLICY,
      transport: { ...DEFAULT_RECOVERY_POLICY.transport, retries: 4 },
    })
  })

  it('replaces out-of-range values with the default for that field only', () => {
    expect(recoveryPolicySchema.parse({ transport: { retries: 99, then: 'dsh' } }).transport).toEqual({ ...DEFAULT_RECOVERY_POLICY.transport, then: 'dsh' })
  })
})
