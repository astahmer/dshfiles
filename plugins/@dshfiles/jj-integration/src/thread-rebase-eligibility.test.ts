import { describe, expect, it } from 'vitest'
import { canRebaseThread, hasPendingUserQuestion } from './thread-rebase-eligibility.js'

describe('thread rebase eligibility', () => {
  it('allows a thread with no sessions', () => {
    expect(canRebaseThread([], () => undefined)).toBe(true)
  })

  it('allows a thread when every session is idle and has no pending question', () => {
    expect(canRebaseThread(['finished', 'idle'], () => ({ running: false, pendingUserQuestion: false }))).toBe(true)
  })

  it('blocks rebasing while any session is working', () => {
    expect(canRebaseThread(['finished', 'working'], sessionId => ({ running: sessionId === 'working', pendingUserQuestion: false }))).toBe(false)
  })

  it('blocks rebasing while a user question waits after the Agent turn stopped', () => {
    expect(canRebaseThread(['waiting'], () => ({ running: false, pendingUserQuestion: true }))).toBe(false)
  })

  it('fails closed when any session activity is unknown', () => {
    expect(canRebaseThread(['finished', 'unknown'], sessionId => (sessionId === 'finished' ? { running: false, pendingUserQuestion: false } : undefined))).toBe(
      false,
    )
  })

  it('fails closed when pending-question state is unknown', () => {
    expect(canRebaseThread(['session'], () => ({ running: false, pendingUserQuestion: undefined }))).toBe(false)
  })

  it('reads unanswered questions from the user-question projection', () => {
    expect(hasPendingUserQuestion({ userQuestions: { active: [{ callId: 'call' }] } })).toBe(true)
    expect(hasPendingUserQuestion({ userQuestions: { active: [] } })).toBe(false)
    expect(hasPendingUserQuestion({})).toBeUndefined()
    expect(hasPendingUserQuestion(undefined)).toBeUndefined()
  })
})
