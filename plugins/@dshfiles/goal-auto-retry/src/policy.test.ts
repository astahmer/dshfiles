import { describe, expect, it } from 'vitest'
import { describeWait, planRetry, ProviderTiming, RetryPolicy } from './policy.js'

const phrase = 'You have hit your ChatGPT usage limit (plus plan). Try again in ~246 min.'

describe('retryable refusals', () => {
  it('retries the account and rate codes', () => {
    for (const code of ['QUOTA', 'RATE_LIMIT', 'ACCOUNT_QUOTA', 'ACCOUNT_TOKEN_INVALID', 'ACCOUNT_SIGN_IN_REQUIRED']) {
      expect(RetryPolicy.isRetryableFailure({ code, message: 'refused' })).toBe(true)
    }
  })

  it('retries a PI_AI_ERROR that words its own wait', () => {
    expect(RetryPolicy.isRetryableFailure({ code: 'PI_AI_ERROR', message: phrase })).toBe(true)
    expect(RetryPolicy.isRetryableFailure({ code: 'PI_AI_ERROR', message: 'Rate limit reached for gpt-6 in organization org-x' })).toBe(true)
    expect(RetryPolicy.isRetryableFailure({ code: 'PI_AI_ERROR', message: 'Quota exceeded for account' })).toBe(true)
  })

  it('control: a plain provider failure is not an account refusal', () => {
    expect(RetryPolicy.isRetryableFailure({ code: 'PI_AI_ERROR', message: 'The model returned an unreadable payload' })).toBe(false)
    expect(RetryPolicy.isRetryableFailure({ code: 'CONTEXT_WINDOW_EXCEEDED', message: 'context exceeded, try again in a new thread' })).toBe(false)
    expect(RetryPolicy.isRetryableFailure({ code: 'INVALID_REQUEST', message: 'bad request' })).toBe(false)
    expect(RetryPolicy.isRetryableFailure({ code: 'TRANSPORT', message: 'socket closed' })).toBe(false)
  })
})

describe('the wait a refusal announces', () => {
  const now = Date.parse('2026-11-19T18:00:00Z')

  it('reads the minutes the whole complaint states', () => {
    expect(ProviderTiming.waitMs({ code: 'PI_AI_ERROR', message: phrase }, 0)).toBe(246 * 60_000)
  })

  it('reads compound wordings once per unit, not once per number', () => {
    expect(ProviderTiming.waitMs({ code: 'QUOTA', message: 'Try again in 2 hours 30 minutes.' }, 0)).toBe(150 * 60_000)
    expect(ProviderTiming.waitMs({ code: 'QUOTA', message: 'retry after 1h30m' }, 0)).toBe(90 * 60_000)
    expect(ProviderTiming.waitMs({ code: 'QUOTA', message: 'available in 45 seconds' }, 0)).toBe(45_000)
  })

  it('does not read an unrelated count as a duration', () => {
    expect(ProviderTiming.waitMs({ code: 'QUOTA', message: 'slot 3 of 5, retry in 10 minutes' }, 0)).toBe(10 * 60_000)
    expect(ProviderTiming.waitMs({ code: 'QUOTA', message: 'the model reported 400 tokens' }, 0)).toBeUndefined()
  })

  it('prefers a stated instant over a stated duration', () => {
    expect(ProviderTiming.waitMs({ code: 'QUOTA', message: 'limit resets at 2026-11-19T20:00:00Z' }, now)).toBe(2 * 3_600_000)
    expect(ProviderTiming.waitMs({ code: 'QUOTA', message: 'resets at 2026-11-19T20:00:00Z, otherwise retry in 5 minutes' }, now)).toBe(2 * 3_600_000)
  })

  it('ignores a reset instant that already passed', () => {
    expect(ProviderTiming.waitMs({ code: 'QUOTA', message: 'reset at 2026-11-19T17:00:00Z' }, now)).toBeUndefined()
  })

  it('prefers the provider-parsed Retry-After', () => {
    expect(ProviderTiming.waitMs({ code: 'RATE_LIMIT', message: 'slow down', resetAtMs: now + 90_000 }, now)).toBe(90_000)
  })

  it('says nothing when the refusal carried no timing', () => {
    expect(ProviderTiming.waitMs({ code: 'QUOTA', message: 'quota exceeded' }, now)).toBeUndefined()
    expect(ProviderTiming.resetAt({ code: 'QUOTA', message: 'quota exceeded' }, now)).toBeUndefined()
  })
})

describe('planning the retry', () => {
  const now = Date.parse('2026-11-19T18:00:00Z')
  const base = { now, attempt: 1, marginMs: 3 * 60_000, minimumDelayMs: 60_000, baseDelayMs: 5 * 60_000, maxBackoffMs: 60 * 60_000 }

  it('follows the announced reset plus the margin', () => {
    const plan = planRetry({ ...base, failure: { code: 'PI_AI_ERROR', message: phrase } })
    expect(plan.source).toBe('reset')
    expect(plan.delayMs).toBe(246 * 60_000 + 3 * 60_000)
    expect(plan.at).toBe(now + plan.delayMs)
  })

  it('still honours the margin when the claim is shorter than it', () => {
    const plan = planRetry({ ...base, failure: { code: 'QUOTA', message: 'usage limit, retry in 2 seconds' } })
    expect(plan.delayMs).toBe(3 * 60_000 + 2_000)
  })

  it('keeps a one-minute floor when the claim is seconds and no margin is set', () => {
    const plan = planRetry({ ...base, marginMs: 0, failure: { code: 'QUOTA', message: 'usage limit, retry in 2 seconds' } })
    expect(plan.delayMs).toBe(60_000)
  })

  it('falls back to doubling backoff when the refusal said nothing', () => {
    expect(planRetry({ ...base, failure: { code: 'QUOTA', message: 'quota exceeded' } })).toMatchObject({ delayMs: 5 * 60_000, source: 'backoff' })
    expect(planRetry({ ...base, attempt: 2, failure: { code: 'QUOTA', message: 'quota exceeded' } })).toMatchObject({ delayMs: 10 * 60_000 })
    expect(planRetry({ ...base, attempt: 9, failure: { code: 'QUOTA', message: 'quota exceeded' } })).toMatchObject({ delayMs: 60 * 60_000 })
    expect(planRetry({ ...base, attempt: 40, failure: { code: 'QUOTA', message: 'quota exceeded' } }).delayMs).toBe(60 * 60_000)
  })

  it('lets the user’s own delay win over what the provider said', () => {
    const plan = planRetry({ ...base, failure: { code: 'PI_AI_ERROR', message: phrase }, overrideDelayMs: 10 * 60_000 })
    expect(plan).toMatchObject({ delayMs: 10 * 60_000, source: 'override' })
  })
})

describe('describeWait', () => {
  it('renders seconds, minutes and hours', () => {
    expect(describeWait(30_000)).toBe('30s')
    expect(describeWait(5 * 60_000)).toBe('5 min')
    expect(describeWait(246 * 60_000)).toBe('4.1 h')
  })
})
