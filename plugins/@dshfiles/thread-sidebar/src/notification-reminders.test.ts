import { describe, expect, it } from 'vitest'
import { NotificationReminderModel, threadNotificationEventIds, type PendingNotificationReminder } from './notification-reminders.js'

const reminder = (overrides: Partial<PendingNotificationReminder>): PendingNotificationReminder => ({
  category: 'turn-finished',
  eventId: threadNotificationEventIds.finish({ sessionId: 'a', finishedSeq: 4 }),
  sessionId: 'a',
  title: 'Turn finished',
  fallbackBody: 'Done',
  message: undefined,
  ...overrides,
})

describe('NotificationReminderModel.stillWaiting', () => {
  it('keeps a finish reminder while that finish is unread, and drops it once read or replaced', () => {
    const finished = reminder({})
    expect(NotificationReminderModel.stillWaiting(finished, { pendingInteractionKey: undefined, unreadFinishedSeq: 4 })).toBe(true)
    expect(NotificationReminderModel.stillWaiting(finished, { pendingInteractionKey: undefined, unreadFinishedSeq: undefined })).toBe(false)
    expect(NotificationReminderModel.stillWaiting(finished, { pendingInteractionKey: undefined, unreadFinishedSeq: 5 })).toBe(false)
  })

  it('keeps a question reminder only while the same question is pending', () => {
    const question = reminder({ category: 'input-needed', eventId: threadNotificationEventIds.input({ sessionId: 'a', interactionKey: 'q1' }) })
    expect(NotificationReminderModel.stillWaiting(question, { pendingInteractionKey: 'q1', unreadFinishedSeq: undefined })).toBe(true)
    expect(NotificationReminderModel.stillWaiting(question, { pendingInteractionKey: 'q2', unreadFinishedSeq: undefined })).toBe(false)
    expect(NotificationReminderModel.stillWaiting(question, { pendingInteractionKey: undefined, unreadFinishedSeq: undefined })).toBe(false)
    const approval = reminder({ category: 'approval-needed', eventId: threadNotificationEventIds.approval({ sessionId: 'a', interactionKey: 'q1' }) })
    expect(NotificationReminderModel.stillWaiting(approval, { pendingInteractionKey: 'q1', unreadFinishedSeq: undefined })).toBe(true)
  })

  it('keeps an agent message reminder until the user looks', () => {
    const message = reminder({ category: 'agent-message', eventId: 'user:1' })
    expect(NotificationReminderModel.stillWaiting(message, { pendingInteractionKey: undefined, unreadFinishedSeq: undefined })).toBe(true)
  })
})

describe('NotificationReminderModel.seenWhileViewing', () => {
  it('is answered by opening its thread, or by looking at DSH when it names none', () => {
    expect(NotificationReminderModel.seenWhileViewing(reminder({}), 'a')).toBe(true)
    expect(NotificationReminderModel.seenWhileViewing(reminder({}), 'b')).toBe(false)
    expect(NotificationReminderModel.seenWhileViewing(reminder({}), undefined)).toBe(false)
    expect(NotificationReminderModel.seenWhileViewing(reminder({ sessionId: null }), undefined)).toBe(true)
  })
})
