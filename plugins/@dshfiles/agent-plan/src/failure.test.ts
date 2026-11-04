import { describe, expect, it } from 'vitest'
import { Failure } from './failure.js'

describe('Failure', () => {
  it('reads a turn error, offers actions unless the turn was stopped, and quotes it in the fix prompt', () => {
    const facts = Failure.fromTurnError({ kind: 'turn-error', message: 'Bad request', code: 'FAKE_FAILURE' })
    expect(Failure.actionable(facts)).toBe(true)
    expect(Failure.fixPrompt(facts)).toBe('The last turn failed with "FAKE_FAILURE: Bad request". Find the cause, fix it, and then continue the task.')
    expect(Failure.actionable(Failure.fromTurnError({ message: '', code: 'INTERRUPTED' }))).toBe(false)
  })

  it('reads the current retry attempt and offers actions only once retrying gave up', () => {
    const scheduled = Failure.fromModelRetry({
      current: { retry: 2, mode: 'normal', maxRetries: 5, retryState: 'scheduled', provider: 'fake', failure: { message: 'Rate limit reached' } },
    })
    expect(Failure.retryLabel(scheduled)).toBe('Retry 2 of 5')
    expect(scheduled.message).toBe('Rate limit reached')
    expect(Failure.actionable(scheduled)).toBe(false)
    const always = Failure.fromModelRetry({ current: { retry: 7, mode: 'always', retryState: 'cancelled', failure: {} } })
    expect(Failure.retryLabel(always)).toBe('Retry 7')
    expect(Failure.actionable(always)).toBe(true)
  })
})
