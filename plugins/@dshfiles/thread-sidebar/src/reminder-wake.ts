/**
 * A reminder always reaches its thread. The settled gate and the native archived gate both reject the step a
 * reminder proposes, and the Schedule service refuses an archived target outright, so a settled or archived
 * thread would quietly drop its reminder. This model decides which threads a reminder needs awake before it is
 * due, so the Host can lift their status in time instead of after the delivery was refused.
 */
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule'

/** One active Schedule task, reduced to what a wake decision reads. */
export interface ScannedReminder {
  readonly id: ScheduleRecord['id']
  /** Session the reminder delivers to; a `new` target creates its own and wakes nothing here. */
  readonly sessionId: string
  /** Canonical instant of its next occurrence, in epoch milliseconds. */
  readonly scheduledAt: number
  /** Whether the task still has a timer obligation; paused and ended tasks wake nothing. */
  readonly active: boolean
}

export interface ReminderWakeInput {
  readonly reminders: readonly ScannedReminder[]
  readonly now: number
  /** How far ahead a wake may run, so a reminder never becomes due while its thread is still stored away. */
  readonly aheadMs: number
  readonly settledSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
}

export interface ReminderWakePlan {
  /** Settled threads whose reminder is due, or due within the wake window: their settled status goes now. */
  readonly unsettle: readonly string[]
  /** Archived threads whose reminder is due, or due within the wake window: they are restored now. */
  readonly restore: readonly string[]
  /**
   * Reminders already due on a thread this plan woke. A refused delivery leaves its occurrence in the past and
   * no timer retries it, so the Host runs those now; a reminder the thread already acknowledged has moved on to
   * its next occurrence and is absent here.
   */
  readonly deliver: readonly ScannedReminder[]
}

const planReminderWake = (input: ReminderWakeInput): ReminderWakePlan => {
  const dueSoon = new Map<string, boolean>()
  for (const reminder of input.reminders) {
    if (!reminder.active || !Number.isFinite(reminder.scheduledAt) || reminder.scheduledAt > input.now + input.aheadMs) continue
    dueSoon.set(reminder.sessionId, (dueSoon.get(reminder.sessionId) ?? false) || reminder.scheduledAt <= input.now)
  }
  const unsettle = [...dueSoon.keys()].filter(sessionId => input.settledSessionIds.has(sessionId))
  const restore = [...dueSoon.keys()].filter(sessionId => input.archivedSessionIds.has(sessionId))
  const woken = new Set([...unsettle, ...restore])
  return {
    unsettle,
    restore,
    deliver: input.reminders.filter(reminder => reminder.active && reminder.scheduledAt <= input.now && woken.has(reminder.sessionId)),
  }
}

/**
 * Whether one queued message came from the Schedule service. The service tags what it enqueues; its source-map
 * augmentation is not loaded here, so the kind is read as a plain string.
 */
const isReminderMessage = (message: { readonly source: { readonly kind: string } }): boolean => String(message.source.kind) === 'schedule'

/** Whether an active reminder holds this thread: such a thread is never settled or archived. */
const hasPendingReminder = (input: { readonly reminders: readonly ScannedReminder[]; readonly sessionId: string }): boolean =>
  input.reminders.some(reminder => reminder.active && reminder.sessionId === input.sessionId)

export class ReminderWakeModel {
  static readonly plan = planReminderWake
  static readonly hasPendingReminder = hasPendingReminder
  static readonly isReminderMessage = isReminderMessage
}
