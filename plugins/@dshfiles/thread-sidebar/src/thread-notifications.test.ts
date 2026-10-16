import assert from 'node:assert/strict'
import { test } from 'vitest'
import { legacyAttentionEntries, threadInteractionTransitions } from './thread-notifications.js'

test('a structured question becomes input-needed attention', () => {
  assert.deepEqual(
    threadInteractionTransitions({ question: { pendingInteractionKey: undefined, pendingInteractionKind: undefined } }, [
      { sessionId: 'question', status: { pendingInteractionKey: 'question-1', pendingInteractionKind: 'question' } },
    ]),
    { approvalNeeded: [], inputNeeded: ['question'] },
  )
})

test('approval and plan-review requests become approval-needed attention', () => {
  const previous = {
    approval: { pendingInteractionKey: undefined, pendingInteractionKind: undefined },
    review: { pendingInteractionKey: undefined, pendingInteractionKind: undefined },
  }
  const current = [
    { sessionId: 'approval', status: { pendingInteractionKey: 'approval-1', pendingInteractionKind: 'approval' } },
    { sessionId: 'review', status: { pendingInteractionKey: 'review-1', pendingInteractionKind: 'plan-review' } },
  ]
  assert.deepEqual(threadInteractionTransitions(previous, current), { approvalNeeded: ['approval', 'review'], inputNeeded: [] })
  assert.deepEqual(threadInteractionTransitions(Object.fromEntries(current.map(entry => [entry.sessionId, entry.status])), current), {
    approvalNeeded: [],
    inputNeeded: [],
  })
})

test('unknown interaction kinds stay unclassified', () => {
  assert.deepEqual(
    threadInteractionTransitions({ thread: { pendingInteractionKey: undefined, pendingInteractionKind: undefined } }, [
      { sessionId: 'thread', status: { pendingInteractionKey: 'opaque-request', pendingInteractionKind: 'other' } },
    ]),
    { approvalNeeded: [], inputNeeded: [] },
  )
})

test('an initial status snapshot does not replay desktop alerts', () => {
  assert.deepEqual(
    threadInteractionTransitions(null, [
      { sessionId: 'question', status: { pendingInteractionKey: 'question-1', pendingInteractionKind: 'question' } },
      { sessionId: 'approval', status: { pendingInteractionKey: 'approval-1', pendingInteractionKind: 'approval' } },
    ]),
    { approvalNeeded: [], inputNeeded: [] },
  )
})

test('browser attention carries over its needs-you timestamps and manual marks', () => {
  assert.deepEqual(
    legacyAttentionEntries({
      enabled: true,
      needsYouAt: { finished: 123 },
      mutedUntil: {},
      manuallyUnreadSessionIds: ['finished', 'marked'],
      seenCompletionSessionIds: ['already-read'],
    }),
    [
      { sessionId: 'finished', finishedAt: 123, manuallyUnread: true },
      { sessionId: 'marked', finishedAt: null, manuallyUnread: true },
    ],
  )
})
