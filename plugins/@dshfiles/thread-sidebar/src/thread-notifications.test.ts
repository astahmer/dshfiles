import assert from 'node:assert/strict'
import { test } from 'vitest'
import { DEFAULT_THREAD_NOTIFICATION_CATEGORIES, ThreadNotificationModel, threadNotificationCategoriesSchema } from './thread-notifications.js'

test('a structured question becomes input-needed attention', () => {
  assert.deepEqual(
    ThreadNotificationModel.threadInteractionTransitions({ question: { pendingInteractionKey: undefined, pendingInteractionKind: undefined } }, [
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
  assert.deepEqual(ThreadNotificationModel.threadInteractionTransitions(previous, current), { approvalNeeded: ['approval', 'review'], inputNeeded: [] })
  assert.deepEqual(ThreadNotificationModel.threadInteractionTransitions(Object.fromEntries(current.map(entry => [entry.sessionId, entry.status])), current), {
    approvalNeeded: [],
    inputNeeded: [],
  })
})

test('unknown interaction kinds stay unclassified', () => {
  assert.deepEqual(
    ThreadNotificationModel.threadInteractionTransitions({ thread: { pendingInteractionKey: undefined, pendingInteractionKind: undefined } }, [
      { sessionId: 'thread', status: { pendingInteractionKey: 'opaque-request', pendingInteractionKind: 'other' } },
    ]),
    { approvalNeeded: [], inputNeeded: [] },
  )
})

test('an initial status snapshot does not replay desktop alerts', () => {
  assert.deepEqual(
    ThreadNotificationModel.threadInteractionTransitions(null, [
      { sessionId: 'question', status: { pendingInteractionKey: 'question-1', pendingInteractionKind: 'question' } },
      { sessionId: 'approval', status: { pendingInteractionKey: 'approval-1', pendingInteractionKind: 'approval' } },
    ]),
    { approvalNeeded: [], inputNeeded: [] },
  )
})

test('browser attention carries over its needs-you timestamps and manual marks', () => {
  assert.deepEqual(
    ThreadNotificationModel.legacyAttentionEntries({
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

test('notification categories default off and validate delivery, sound, and volume together', () => {
  assert.deepEqual(threadNotificationCategoriesSchema.parse(undefined), DEFAULT_THREAD_NOTIFICATION_CATEGORIES)
  assert.equal(threadNotificationCategoriesSchema.safeParse({ ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES, failed: { delivery: 'popup' } }).success, false)
  assert.equal(
    threadNotificationCategoriesSchema.safeParse({
      ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES,
      failed: { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES.failed, volume: 2 },
    }).success,
    false,
  )
  assert.equal(ThreadNotificationModel.threadNotificationHasOutput(DEFAULT_THREAD_NOTIFICATION_CATEGORIES.failed), false)
  assert.equal(ThreadNotificationModel.threadNotificationHasOutput({ ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES.failed, sound: true }), true)
})

test('delivery routing distinguishes in-app, system, both, and off', () => {
  assert.deepEqual(
    ['off', 'in-app', 'system', 'both'].map(delivery => {
      const parsed = threadNotificationCategoriesSchema.parse({
        ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES,
        'approval-needed': { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES['approval-needed'], delivery },
      })
      const route = parsed['approval-needed'].delivery
      return [ThreadNotificationModel.notificationRouteHasInApp(route), ThreadNotificationModel.notificationRouteHasSystem(route)]
    }),
    [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ],
  )
})

test('only completed and error endings notify; cancellation and interruption are not failures', () => {
  assert.equal(ThreadNotificationModel.categoryForFinishReason('completed'), 'turn-finished')
  assert.equal(ThreadNotificationModel.categoryForFinishReason('error'), 'failed')
  assert.equal(ThreadNotificationModel.categoryForFinishReason('aborted'), undefined)
  assert.equal(ThreadNotificationModel.categoryForFinishReason('blocked'), undefined)
  assert.equal(ThreadNotificationModel.categoryForFinishReason('max-tokens'), undefined)
})

test('event claims deduplicate ids and retain only the newest 5,000', () => {
  const firstClaim = ThreadNotificationModel.claimNotificationEvent([], 'approval:thread:key')
  assert.deepEqual(firstClaim, { claimed: true, notificationIds: ['approval:thread:key'] })
  assert.deepEqual(ThreadNotificationModel.claimNotificationEvent(firstClaim.notificationIds, 'approval:thread:key'), {
    claimed: false,
    notificationIds: firstClaim.notificationIds,
  })

  const fullLedger = Array.from({ length: 5_000 }, (_value, index) => `event-${index}`)
  const boundedClaim = ThreadNotificationModel.claimNotificationEvent(fullLedger, 'new-event')
  assert.equal(boundedClaim.notificationIds.length, 5_000)
  assert.equal(boundedClaim.notificationIds[0], 'event-1')
  assert.equal(boundedClaim.notificationIds.at(-1), 'new-event')
})
