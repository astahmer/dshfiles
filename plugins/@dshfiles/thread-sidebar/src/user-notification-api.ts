import { defineApi, event, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

export const USER_NOTIFICATION_TITLE_LIMIT = 120
export const USER_NOTIFICATION_BODY_LIMIT = 500

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))

const notificationSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(USER_NOTIFICATION_TITLE_LIMIT)),
  body: Schema.String.check(Schema.isMaxLength(USER_NOTIFICATION_BODY_LIMIT)),
  /** The thread a click opens; null for a notification about no thread. */
  sessionId: Schema.NullOr(sessionIdSchema),
})
export type UserNotification = typeof notificationSchema.Type

/** Why a sent notification showed nothing; `no-open-page` when no page answered in time. */
export const USER_NOTIFICATION_SKIP_REASONS = [
  'category-off',
  'snoozed',
  'thread-muted',
  'watched-thread',
  'system-permission',
  'subagent-hidden',
  'no-open-page',
] as const
export type UserNotificationSkipReason = (typeof USER_NOTIFICATION_SKIP_REASONS)[number]

/** What one page did with a notification: `duplicate` means another tab already took it, so it says nothing. */
export const USER_NOTIFICATION_PAGE_OUTCOMES = ['shown', 'duplicate', ...USER_NOTIFICATION_SKIP_REASONS.filter(reason => reason !== 'no-open-page')] as const
export type UserNotificationPageOutcome = (typeof USER_NOTIFICATION_PAGE_OUTCOMES)[number]

/** The next step for the user, so the agent can pass it on in its reply. */
export const userNotificationRecovery = {
  'category-off':
    'The user’s “Input needed” notifications are off: they can turn them on in Settings › Notifications › Thread notifications › Input needed (In-app, System or Both).',
  snoozed:
    'Notifications are snoozed in this browser: the user can resume them with Resume notifications in Settings › Notifications › Thread notifications or the command palette.',
  'thread-muted': 'This thread is muted: the user can choose Unmute in its thread menu.',
  'watched-thread': 'The user has this thread open in a focused window, so they see your reply here.',
  'system-permission':
    'Only system delivery is chosen and this browser has not granted notification permission: the user can grant it in Settings › Notifications › Thread notifications, or add In-app delivery.',
  'subagent-hidden':
    'Alerts from subagent threads are off: notify from the parent thread, or the user can turn on subagent attention in Settings › Thread list.',
  'no-open-page': 'No DSH page is open to show it.',
} satisfies Readonly<Record<UserNotificationSkipReason, string>>

const sendOutputSchema = Schema.Struct({
  status: Schema.Literals(['sent', 'rate-limited']),
  /** At least one open page showed it (toast, system notification or sound). */
  delivered: Schema.Boolean,
  reason: Schema.NullOr(Schema.Literals(USER_NOTIFICATION_SKIP_REASONS)),
  recovery: Schema.NullOr(Schema.String),
  id: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(sessionIdSchema),
  /** When a rate-limited send may be tried again. */
  retryAfterSeconds: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
})
export type UserNotificationSendOutput = typeof sendOutputSchema.Type

const renderSend = (output: UserNotificationSendOutput): string => {
  if (output.status === 'rate-limited')
    return `Not sent: too many notifications from this thread. Try again in ${String(output.retryAfterSeconds ?? 0)} s, or tell the user in your reply.`
  if (output.delivered) return `Notification shown to the user${output.sessionId === null ? '' : ` for thread ${output.sessionId}`}.`
  return `Not shown (delivered: false, ${output.reason ?? 'unknown'}). ${output.recovery ?? ''} Tell the user in your reply instead.`.replace('  ', ' ')
}

/**
 * One notification the agent (or a script) sends the user through the sidebar's existing route: the browser shows it
 * in-app and as a system notification according to the user's “Input needed” category, and a click opens the thread.
 */
export const userNotificationApi = defineApi({
  id: 'thread-user-notifications',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    send: method({
      // Plain Struct: a strict wrapper publishes no object JSON Schema, and the tool would take no arguments.
      input: Schema.Struct({
        title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(USER_NOTIFICATION_TITLE_LIMIT)).annotate({
          description: 'Short headline, such as “Migration finished”.',
        }),
        body: Schema.optional(
          Schema.String.check(Schema.isMaxLength(USER_NOTIFICATION_BODY_LIMIT)).annotate({ description: 'What happened and what the user should look at.' }),
        ),
        sessionId: Schema.optional(
          Schema.NullOr(sessionIdSchema).annotate({
            description: 'Thread a click opens. Omit for the calling thread; null for a notification about no thread.',
          }),
        ),
      }),
      output: sendOutputSchema,
      description:
        'Send the user a notification (title and body, optionally linking a thread) through their configured notification routes. Call only when the user asked to be notified, or when a long task or routine reaches a result or a blocker that needs the user’s attention; never for progress updates. The text appears in the operating system notification center: never include secrets or credentials. Rate-limited per thread.',
      tool: { name: 'notify_user', readOnly: false, render: renderSend },
    }),
    acknowledge: method({
      input: Schema.Struct({
        id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
        outcome: Schema.Literals(USER_NOTIFICATION_PAGE_OUTCOMES),
      }),
      output: Schema.Struct({ accepted: Schema.Boolean }),
      description: 'An open page reports what it did with a sent notification, so send can say whether the user saw it.',
    }),
  },
  events: {
    sent: event({ schema: notificationSchema, description: 'A notification to show the user; every open page routes it through its notification settings.' }),
  },
})
