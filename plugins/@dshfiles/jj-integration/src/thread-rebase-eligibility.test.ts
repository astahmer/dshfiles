import { describe, expect, it } from 'vitest'
import { SESSION_ACTIVITY_PROJECTIONS, ThreadRebaseEligibilityModel, type ThreadSessionActivity } from './thread-rebase-eligibility.js'

describe('thread rebase eligibility', () => {
  it('asks the Session list only for the columns the activity fold reads', () => {
    expect([...SESSION_ACTIVITY_PROJECTIONS]).toEqual(['title', 'userQuestions'])
  })

  it('allows a thread with no sessions', () => {
    expect(ThreadRebaseEligibilityModel.canRebase([], () => undefined)).toBe(true)
  })

  it('allows header Rebase from a known-idle client snapshot before Host activity refreshes', () => {
    expect(ThreadRebaseEligibilityModel.fromClientSnapshot({ threadSessionsEligible: true, sessionRunning: false, questionPending: false })).toBe(true)
  })

  it('blocks header Rebase when the current client snapshot shows activity or is incomplete', () => {
    expect(ThreadRebaseEligibilityModel.fromClientSnapshot({ threadSessionsEligible: false, sessionRunning: false, questionPending: false })).toBe(false)
    expect(ThreadRebaseEligibilityModel.fromClientSnapshot({ threadSessionsEligible: true, sessionRunning: true, questionPending: false })).toBe(false)
    expect(ThreadRebaseEligibilityModel.fromClientSnapshot({ threadSessionsEligible: true, sessionRunning: false, questionPending: true })).toBe(false)
  })

  it('keeps a missing Host activity snapshot distinct from an ineligible thread', () => {
    expect(ThreadRebaseEligibilityModel.canRebaseIfKnown(['session'], undefined)).toBeUndefined()
    expect(ThreadRebaseEligibilityModel.canRebaseIfKnown(['session'], new Map([['session', { running: true, pendingUserQuestion: false }]]))).toBe(false)
    expect(ThreadRebaseEligibilityModel.canRebaseIfKnown(['session'], new Map([['session', { running: false, pendingUserQuestion: false }]]))).toBe(true)
    expect(ThreadRebaseEligibilityModel.canRebaseIfKnown([], undefined)).toBe(true)
  })

  it('allows a thread when every session is idle and has no pending question', () => {
    expect(ThreadRebaseEligibilityModel.canRebase(['finished', 'idle'], () => ({ running: false, pendingUserQuestion: false }))).toBe(true)
  })

  it('blocks rebasing while any session is working', () => {
    expect(
      ThreadRebaseEligibilityModel.canRebase(['finished', 'working'], sessionId => ({ running: sessionId === 'working', pendingUserQuestion: false })),
    ).toBe(false)
  })

  it('blocks rebasing while a user question waits after the Agent turn stopped', () => {
    expect(ThreadRebaseEligibilityModel.canRebase(['waiting'], () => ({ running: false, pendingUserQuestion: true }))).toBe(false)
  })

  it('distinguishes unknown session activity from confirmed active work', () => {
    expect(
      ThreadRebaseEligibilityModel.canRebase(['finished', 'unknown'], sessionId =>
        sessionId === 'finished' ? { running: false, pendingUserQuestion: false } : undefined,
      ),
    ).toBe(undefined)
    expect(
      ThreadRebaseEligibilityModel.canRebase(['active', 'unknown'], sessionId =>
        sessionId === 'active' ? { running: true, pendingUserQuestion: false } : undefined,
      ),
    ).toBe(false)
  })

  it('reports unknown when pending-question state is unavailable', () => {
    expect(ThreadRebaseEligibilityModel.canRebase(['session'], () => ({ running: false, pendingUserQuestion: undefined }))).toBeUndefined()
  })

  it('reads unanswered questions from the user-question projection', () => {
    expect(ThreadRebaseEligibilityModel.hasPendingUserQuestion({ userQuestions: { active: [{ callId: 'call' }] } })).toBe(true)
    expect(ThreadRebaseEligibilityModel.hasPendingUserQuestion({ userQuestions: { active: [] } })).toBe(false)
    expect(ThreadRebaseEligibilityModel.hasPendingUserQuestion({})).toBeUndefined()
    expect(ThreadRebaseEligibilityModel.hasPendingUserQuestion(undefined)).toBeUndefined()
  })
})

describe('workspace blockers', () => {
  const idle = { running: false, pendingUserQuestion: false }

  it('names nothing while every Session is idle', () => {
    expect(
      ThreadRebaseEligibilityModel.blockers({
        sessionIds: ['a', 'b'],
        activity: new Map([
          ['a', idle],
          ['b', idle],
        ]),
      }),
    ).toEqual([])
  })

  it('names a working Session with its title', () => {
    expect(
      ThreadRebaseEligibilityModel.blockers({
        sessionIds: ['mine', 'other'],
        activity: new Map<string, ThreadSessionActivity>([
          ['mine', idle],
          ['other', { running: true, pendingUserQuestion: false, title: 'Keyboard-accessible session list' }],
        ]),
      }),
    ).toEqual([{ sessionId: 'other', title: 'Keyboard-accessible session list', reason: 'working' }])
  })

  it('reports an unanswered question once the turn stopped', () => {
    expect(
      ThreadRebaseEligibilityModel.blockers({
        sessionIds: ['other'],
        activity: new Map<string, ThreadSessionActivity>([['other', { running: false, pendingUserQuestion: true, title: 'Move tabs between sidepanels' }]]),
      }),
    ).toEqual([{ sessionId: 'other', title: 'Move tabs between sidepanels', reason: 'question' }])
  })

  it('treats work as the reason when a Session both runs and asks', () => {
    expect(
      ThreadRebaseEligibilityModel.blockers({
        sessionIds: ['other'],
        activity: new Map([['other', { running: true, pendingUserQuestion: true }]]),
      }),
    ).toEqual([{ sessionId: 'other', title: undefined, reason: 'working' }])
  })

  it('names nothing when activity is unknown, so the guard keeps its separate message', () => {
    expect(ThreadRebaseEligibilityModel.blockers({ sessionIds: ['a'], activity: undefined })).toEqual([])
    expect(ThreadRebaseEligibilityModel.blockers({ sessionIds: ['ghost'], activity: new Map() })).toEqual([])
  })
})

describe('rebase guard session scope', () => {
  it('exempts the calling agent so it can rebase its own thread after a handed-back problem', () => {
    expect(ThreadRebaseEligibilityModel.guardSessionIds({ sessionIds: ['agent'], fromAgent: true, sessionId: 'agent' })).toEqual([])
  })

  it('keeps another working session of the same thread in scope', () => {
    expect(ThreadRebaseEligibilityModel.guardSessionIds({ sessionIds: ['agent', 'sibling'], fromAgent: true, sessionId: 'agent' })).toEqual(['sibling'])
  })

  it('keeps the caller in scope for the UI and /rebase paths', () => {
    expect(ThreadRebaseEligibilityModel.guardSessionIds({ sessionIds: ['agent'], fromAgent: false, sessionId: 'agent' })).toEqual(['agent'])
  })

  it('keeps a supervisor in scope when it rebases another thread', () => {
    expect(ThreadRebaseEligibilityModel.guardSessionIds({ sessionIds: ['worker'], fromAgent: true, sessionId: 'supervisor' })).toEqual(['worker'])
  })

  it('exempts nothing when the agent session id is unknown', () => {
    expect(ThreadRebaseEligibilityModel.guardSessionIds({ sessionIds: ['agent'], fromAgent: true, sessionId: undefined })).toEqual(['agent'])
  })

  it('lets the exempted caller rebase while its own activity is unknown', () => {
    const guardSessionIds = ThreadRebaseEligibilityModel.guardSessionIds({ sessionIds: ['agent'], fromAgent: true, sessionId: 'agent' })
    expect(ThreadRebaseEligibilityModel.canRebaseIfKnown(guardSessionIds, new Map())).toBe(true)
  })
})

describe('thread rebase eligibility as the caller sees it', () => {
  const idle = { running: false, pendingUserQuestion: false }
  const working = { running: true, pendingUserQuestion: false }

  it('tells an Agent its own thread is rebasable while it works', () => {
    expect(
      ThreadRebaseEligibilityModel.eligibility({
        sessionIds: ['agent'],
        activity: new Map([['agent', working]]),
        fromAgent: true,
        sessionId: 'agent',
      }),
    ).toBe(true)
  })

  it('keeps a sibling Session blocking the same Agent', () => {
    expect(
      ThreadRebaseEligibilityModel.eligibility({
        sessionIds: ['agent', 'sibling'],
        activity: new Map([
          ['agent', working],
          ['sibling', working],
        ]),
        fromAgent: true,
        sessionId: 'agent',
      }),
    ).toBe(false)
  })

  it('keeps the UI and /rebase paths strict about the Session they show', () => {
    expect(
      ThreadRebaseEligibilityModel.eligibility({
        sessionIds: ['agent'],
        activity: new Map([['agent', working]]),
        fromAgent: false,
        sessionId: 'agent',
      }),
    ).toBe(false)
  })

  it('still fails closed when a checked Session has no activity', () => {
    expect(
      ThreadRebaseEligibilityModel.eligibility({
        sessionIds: ['agent', 'ghost'],
        activity: new Map([['agent', working]]),
        fromAgent: true,
        sessionId: 'agent',
      }),
    ).toBeUndefined()
    expect(ThreadRebaseEligibilityModel.eligibility({ sessionIds: ['agent'], activity: undefined, fromAgent: true, sessionId: 'agent' })).toBe(true)
    expect(
      ThreadRebaseEligibilityModel.eligibility({ sessionIds: ['agent', 'ghost'], activity: undefined, fromAgent: true, sessionId: 'agent' }),
    ).toBeUndefined()
  })

  it('agrees with the guard the rebase itself applies', () => {
    const input = {
      sessionIds: ['agent', 'sibling'],
      activity: new Map([
        ['agent', working],
        ['sibling', idle],
      ]),
      fromAgent: true,
      sessionId: 'agent',
    }
    expect(ThreadRebaseEligibilityModel.eligibility(input)).toBe(
      ThreadRebaseEligibilityModel.canRebaseIfKnown(ThreadRebaseEligibilityModel.guardSessionIds(input), input.activity),
    )
  })
})
