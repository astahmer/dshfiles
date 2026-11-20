import { describe, expect, it } from 'vitest'
import { Failure } from './failure.js'

describe('Failure', () => {
  it('reads a turn error, offers the action unless the turn was stopped, and quotes it in the fix prompt', () => {
    const facts = Failure.fromTurnError({ message: 'Bad request', code: 'FAKE_FAILURE' })
    expect(Failure.actionable(facts)).toBe(true)
    expect(Failure.fixPrompt(facts)).toBe('The last turn failed with "FAKE_FAILURE: Bad request". Find the cause, fix it, and then continue the task.')
    expect(Failure.actionable(Failure.fromTurnError({ message: '', code: 'INTERRUPTED' }))).toBe(false)
  })

  it('reads the empty code the failure card passes for a failure without one', () => {
    const facts = Failure.fromTurnError({ message: 'Connection refused', code: '' })
    expect(facts.code).toBeUndefined()
    expect(Failure.fixPrompt(facts)).toBe('The last turn failed with "Connection refused". Find the cause, fix it, and then continue the task.')
  })
})
