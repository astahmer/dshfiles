import type { ThreadNotificationCategory } from './thread-notifications.js'

/** The event ids a thread notification is claimed under; a reminder compares them with the thread's current state. */
export const threadNotificationEventIds = {
  approval: (input: { readonly sessionId: string; readonly interactionKey: string }): string => `approval:${input.sessionId}:${input.interactionKey}`,
  input: (input: { readonly sessionId: string; readonly interactionKey: string }): string => `input:${input.sessionId}:${input.interactionKey}`,
  finish: (input: { readonly sessionId: string; readonly finishedSeq: number }): string => `finish:${input.sessionId}:${input.finishedSeq}`,
  reminder: (eventId: string): string => `${eventId}:reminder`,
} as const

/** A shown notification that plays again once the delay passes, unless the user saw its thread first. */
export interface PendingNotificationReminder {
  readonly category: ThreadNotificationCategory
  readonly eventId: string
  readonly sessionId: string | null
  readonly title: string
  readonly fallbackBody: string
  readonly message: string | undefined
}

/** What the thread looks like when the reminder is due. */
export interface ReminderThreadState {
  readonly pendingInteractionKey: string | undefined
  /** The finish sequence of the thread's unread attention record; undefined once the user read it. */
  readonly unreadFinishedSeq: number | null | undefined
}

export class NotificationReminderModel {
  /** Whether the event the notification announced still waits for the user, so a reminder is not stale. */
  static readonly stillWaiting = (reminder: PendingNotificationReminder, state: ReminderThreadState): boolean => {
    if (reminder.sessionId === null || reminder.category === 'agent-message') return true
    const sessionId = reminder.sessionId
    if (reminder.category === 'approval-needed' || reminder.category === 'input-needed') {
      if (state.pendingInteractionKey === undefined) return false
      const build = reminder.category === 'approval-needed' ? threadNotificationEventIds.approval : threadNotificationEventIds.input
      return reminder.eventId === build({ sessionId, interactionKey: state.pendingInteractionKey })
    }
    if (state.unreadFinishedSeq === undefined || state.unreadFinishedSeq === null) return false
    return reminder.eventId === threadNotificationEventIds.finish({ sessionId, finishedSeq: state.unreadFinishedSeq })
  }

  /**
   * Called while DSH is visible and focused: opening the thread a reminder is about answers it, and a reminder about no
   * thread is answered by looking at DSH at all.
   */
  static readonly seenWhileViewing = (reminder: PendingNotificationReminder, viewedSessionId: string | undefined): boolean =>
    reminder.sessionId === null || reminder.sessionId === viewedSessionId
}
