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

const sendOutputSchema = Schema.Struct({
  status: Schema.Literals(['sent', 'rate-limited']),
  id: Schema.NullOr(Schema.String),
  sessionId: Schema.NullOr(sessionIdSchema),
  /** When a rate-limited send may be tried again. */
  retryAfterSeconds: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
})
export type UserNotificationSendOutput = typeof sendOutputSchema.Type

const renderSend = (output: UserNotificationSendOutput): string =>
  output.status === 'sent'
    ? `Notification sent${output.sessionId === null ? '' : ` for thread ${output.sessionId}`}. It shows on the routes the user chose for “Input needed” notifications; a muted thread, muted notifications or an open, focused view of that thread show nothing.`
    : `Not sent: too many notifications from this thread. Try again in ${String(output.retryAfterSeconds ?? 0)} s, or keep the message for the end of the turn.`

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
  },
  events: {
    sent: event({ schema: notificationSchema, description: 'A notification to show the user; every open page routes it through its notification settings.' }),
  },
})
