import assert from 'node:assert/strict'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { test } from 'vitest'
import { z } from 'zod'
import {
  createThreadNotificationClaimer,
  DEFAULT_THREAD_NOTIFICATION_CATEGORIES,
  ThreadNotificationModel,
  threadNotificationCategoriesSchema,
} from './thread-notifications.js'

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

test('categories saved before the stopped category decode with it defaulted in', () => {
  const { stopped: _stopped, ...savedBeforeStopped } = DEFAULT_THREAD_NOTIFICATION_CATEGORIES
  const parsed = threadNotificationCategoriesSchema.parse({
    ...savedBeforeStopped,
    'turn-finished': { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES['turn-finished'], delivery: 'system', sound: true },
  })
  assert.deepEqual(parsed.stopped, DEFAULT_THREAD_NOTIFICATION_CATEGORIES.stopped)
  assert.equal(parsed['turn-finished'].delivery, 'system')
  assert.equal(parsed['turn-finished'].sound, true)
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

test('completed, stopped, and error endings each notify as their own category', () => {
  assert.equal(ThreadNotificationModel.categoryForFinishReason('completed'), 'turn-finished')
  assert.equal(ThreadNotificationModel.categoryForFinishReason('error'), 'failed')
  assert.equal(ThreadNotificationModel.categoryForFinishReason('aborted'), 'stopped')
  assert.equal(ThreadNotificationModel.categoryForFinishReason('blocked'), 'stopped')
  assert.equal(ThreadNotificationModel.categoryForFinishReason('max-tokens'), 'stopped')
})

test('system delivery proceeds when the browser refuses the deduplication ledger write', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('storage unavailable')
    },
    removeItem: () => undefined,
  }
  const ledger = createStoredValue({ key: 'notification-test', schema: z.array(z.string()), fallback: [], storage: () => storage })
  const claim = createThreadNotificationClaimer(ledger)
  const route = threadNotificationCategoriesSchema.parse({
    ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES,
    'turn-finished': { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES['turn-finished'], delivery: 'system' },
  })['turn-finished']
  const browserPermission = 'granted'
  const systemDeliveryReady = ThreadNotificationModel.notificationRouteHasSystem(route.delivery) && browserPermission === 'granted'
  let createdSystemNotifications = 0
  const deliver = (eventId: string): void => {
    if (!systemDeliveryReady || !claim(eventId)) return
    createdSystemNotifications += 1
  }

  deliver('finish:thread:1')
  deliver('finish:thread:1')
  assert.equal(createdSystemNotifications, 1)
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
