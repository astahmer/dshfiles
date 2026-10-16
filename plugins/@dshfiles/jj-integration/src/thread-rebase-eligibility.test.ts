import { describe, expect, it } from 'vitest'
import {
  canRebaseFromClientSnapshot,
  canRebaseThread,
  canRebaseThreadIfKnown,
  hasPendingUserQuestion,
  rebaseGuardSessionIds,
} from './thread-rebase-eligibility.js'

describe('thread rebase eligibility', () => {
  it('allows a thread with no sessions', () => {
    expect(canRebaseThread([], () => undefined)).toBe(true)
  })

  it('allows header Rebase from a known-idle client snapshot before Host activity refreshes', () => {
    expect(canRebaseFromClientSnapshot({ threadSessionsEligible: true, sessionRunning: false, questionPending: false })).toBe(true)
  })

  it('blocks header Rebase when the current client snapshot shows activity or is incomplete', () => {
    expect(canRebaseFromClientSnapshot({ threadSessionsEligible: false, sessionRunning: false, questionPending: false })).toBe(false)
    expect(canRebaseFromClientSnapshot({ threadSessionsEligible: true, sessionRunning: true, questionPending: false })).toBe(false)
    expect(canRebaseFromClientSnapshot({ threadSessionsEligible: true, sessionRunning: false, questionPending: true })).toBe(false)
  })

  it('keeps a missing Host activity snapshot distinct from an ineligible thread', () => {
    expect(canRebaseThreadIfKnown(['session'], undefined)).toBeUndefined()
    expect(canRebaseThreadIfKnown(['session'], new Map([['session', { running: true, pendingUserQuestion: false }]]))).toBe(false)
    expect(canRebaseThreadIfKnown(['session'], new Map([['session', { running: false, pendingUserQuestion: false }]]))).toBe(true)
    expect(canRebaseThreadIfKnown([], undefined)).toBe(true)
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

describe('rebase guard session scope', () => {
  it('exempts the calling agent so it can rebase its own thread after a handed-back problem', () => {
    expect(rebaseGuardSessionIds({ sessionIds: ['agent'], fromAgent: true, sessionId: 'agent' })).toEqual([])
  })

  it('keeps another working session of the same thread in scope', () => {
    expect(rebaseGuardSessionIds({ sessionIds: ['agent', 'sibling'], fromAgent: true, sessionId: 'agent' })).toEqual(['sibling'])
  })

  it('keeps the caller in scope for the UI and /rebase paths', () => {
    expect(rebaseGuardSessionIds({ sessionIds: ['agent'], fromAgent: false, sessionId: 'agent' })).toEqual(['agent'])
  })

  it('keeps a supervisor in scope when it rebases another thread', () => {
    expect(rebaseGuardSessionIds({ sessionIds: ['worker'], fromAgent: true, sessionId: 'supervisor' })).toEqual(['worker'])
  })

  it('exempts nothing when the agent session id is unknown', () => {
    expect(rebaseGuardSessionIds({ sessionIds: ['agent'], fromAgent: true, sessionId: undefined })).toEqual(['agent'])
  })

  it('lets the exempted caller rebase while its own activity is unknown', () => {
    const guardSessionIds = rebaseGuardSessionIds({ sessionIds: ['agent'], fromAgent: true, sessionId: 'agent' })
    expect(canRebaseThreadIfKnown(guardSessionIds, new Map())).toBe(true)
  })
})
