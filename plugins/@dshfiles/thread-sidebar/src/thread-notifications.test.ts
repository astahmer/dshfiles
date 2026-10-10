import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  clearExpiredThreadMutes,
  clearThreadMute,
  DEFAULT_THREAD_NOTIFICATION_PREFERENCES,
  isThreadMuted,
  markThreadSeen,
  setThreadMute,
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
test('timed snooze expires, while permanent mute lasts until cleared', () => {
  const timed = setThreadMute(DEFAULT_THREAD_NOTIFICATION_PREFERENCES, 'timed', 100)
  const muted = setThreadMute(timed, 'forever', null)
  assert.equal(isThreadMuted(muted, 'timed', 99), true)
  assert.equal(isThreadMuted(muted, 'timed', 100), false)
  assert.equal(isThreadMuted(muted, 'forever', 1_000_000), true)
  assert.deepEqual(clearExpiredThreadMutes(muted, 100).mutedUntil, { forever: null })
  assert.deepEqual(clearThreadMute(muted, 'forever').mutedUntil, { timed: 100 })
})
test('opening a thread clears its needs-you marker and keeps mute settings', () => {
  const muted = setThreadMute({ ...DEFAULT_THREAD_NOTIFICATION_PREFERENCES, needsYouAt: { thread: 123 } }, 'thread', null)
  assert.deepEqual(markThreadSeen(muted, 'thread'), { ...muted, needsYouAt: {} })
})
