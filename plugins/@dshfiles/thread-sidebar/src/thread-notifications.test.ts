import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  DEFAULT_THREAD_NOTIFICATION_PREFERENCES,
  isThreadUnread,
  markThreadSeen,
  markThreadUnread,
  threadAttentionTransitions,
} from './thread-notifications.js'
test('structured question and completed turn have distinct transitions', () => {
  assert.deepEqual(
    threadAttentionTransitions(
      {
        question: { pendingInteractionKey: undefined, pendingInteractionKind: undefined, completionUnread: false },
        finished: { pendingInteractionKey: undefined, pendingInteractionKind: undefined, completionUnread: false },
      },
      [
        { sessionId: 'question', status: { pendingInteractionKey: 'question-1', pendingInteractionKind: 'question', completionUnread: false } },
        { sessionId: 'finished', status: { pendingInteractionKey: undefined, pendingInteractionKind: undefined, completionUnread: true } },
      ],
    ),
    { approvalNeeded: [], inputNeeded: ['question'], turnFinished: ['finished'] },
  )
})
test('approval and plan-review requests share their own state and take precedence over turn-finished', () => {
  const previous = {
    approval: { pendingInteractionKey: undefined, pendingInteractionKind: undefined, completionUnread: false },
    review: { pendingInteractionKey: undefined, pendingInteractionKind: undefined, completionUnread: false },
  }
  const approval = {
    sessionId: 'approval',
    status: { pendingInteractionKey: 'approval-1', pendingInteractionKind: 'approval', completionUnread: true },
  }
  const review = {
    sessionId: 'review',
    status: { pendingInteractionKey: 'review-1', pendingInteractionKind: 'plan-review', completionUnread: true },
  }
  const current = [approval, review]
  assert.deepEqual(threadAttentionTransitions(previous, current), { approvalNeeded: ['approval', 'review'], inputNeeded: [], turnFinished: [] })
  assert.deepEqual(threadAttentionTransitions({ approval: approval.status, review: review.status }, current), {
    approvalNeeded: [],
    inputNeeded: [],
    turnFinished: [],
  })
})
test('unknown interaction kinds remain unclassified and do not suppress completion', () => {
  assert.deepEqual(
    threadAttentionTransitions({ thread: { pendingInteractionKey: undefined, pendingInteractionKind: undefined, completionUnread: false } }, [
      { sessionId: 'thread', status: { pendingInteractionKey: 'opaque-request', pendingInteractionKind: 'other', completionUnread: true } },
    ]),
    { approvalNeeded: [], inputNeeded: [], turnFinished: ['thread'] },
  )
})
test('initial status does not replay desktop attention alerts', () => {
  assert.deepEqual(
    threadAttentionTransitions(null, [
      { sessionId: 'question', status: { pendingInteractionKey: 'question-1', pendingInteractionKind: 'question', completionUnread: true } },
      { sessionId: 'approval', status: { pendingInteractionKey: 'approval-1', pendingInteractionKind: 'approval', completionUnread: true } },
    ]),
    { approvalNeeded: [], inputNeeded: [], turnFinished: [] },
  )
})
test('manual unread clears when the thread is opened', () => {
  const markedUnread = markThreadUnread(DEFAULT_THREAD_NOTIFICATION_PREFERENCES, 'thread')
  assert.equal(isThreadUnread(markedUnread, 'thread'), true)
  assert.equal(isThreadUnread(DEFAULT_THREAD_NOTIFICATION_PREFERENCES, 'thread'), false)
  assert.deepEqual(markThreadSeen(markedUnread, 'thread').manuallyUnreadSessionIds, [])
  assert.deepEqual(markThreadUnread(markedUnread, 'thread').manuallyUnreadSessionIds, ['thread'])
})

test('opening a thread clears its needs-you and manual unread markers', () => {
  const markedUnread = markThreadUnread({ ...DEFAULT_THREAD_NOTIFICATION_PREFERENCES, needsYouAt: { thread: 123 } }, 'thread')
  assert.deepEqual(markThreadSeen(markedUnread, 'thread'), {
    ...markedUnread,
    needsYouAt: {},
    manuallyUnreadSessionIds: [],
  })
})

test('opening one thread preserves another thread unread marker', () => {
  const firstUnread = markThreadUnread(DEFAULT_THREAD_NOTIFICATION_PREFERENCES, 'first')
  const bothUnread = markThreadUnread(firstUnread, 'second')
  const secondSeen = markThreadSeen(bothUnread, 'second')

  assert.equal(isThreadUnread(bothUnread, 'first'), true)
  assert.equal(isThreadUnread(bothUnread, 'second'), true)
  assert.equal(isThreadUnread(secondSeen, 'first'), true)
  assert.equal(isThreadUnread(secondSeen, 'second'), false)
})
