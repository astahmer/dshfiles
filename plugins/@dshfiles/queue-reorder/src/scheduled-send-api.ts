import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

/** The longest message a scheduled send holds; the session controller's prompt takes as much. */
export const MAX_SCHEDULED_TEXT = 100_000
/** How far ahead a send may be scheduled. */
export const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const sendIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))
const epochMsSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const textSchema = Schema.String.check(
  Schema.isMaxLength(MAX_SCHEDULED_TEXT),
  Schema.makeFilter(text => (text.trim().length > 0 ? undefined : 'A scheduled message needs some text.')),
)

export const sendModelSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(400)),
  reasoningEffort: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
})
export type SendModel = typeof sendModelSchema.Type

export const scheduledSendSchema = Schema.Struct({
  id: sendIdSchema,
  sessionId: sessionIdSchema,
  text: textSchema,
  sendAt: epochMsSchema,
  /** Model and effort the thread switches to just before this message is sent; absent keeps the thread's own. */
  model: Schema.optional(sendModelSchema),
  createdAt: epochMsSchema,
  /** `sending` is committed before delivery, so a Host that stops mid-send retries it under the same request id. */
  status: Schema.Literals(['scheduled', 'sending', 'failed']),
  /** The prompt's idempotency key: a retried delivery never adds the message twice. */
  requestId: Schema.String.check(Schema.isUUID()),
  attempts: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  /** Why the send is late (a busy queue) or failed, with what to do next. */
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(1_000))),
  /** A late send's next try; it never runs before `sendAt`. */
  retryAt: Schema.optional(epochMsSchema),
})
export type ScheduledSend = typeof scheduledSendSchema.Type

const sendListSchema = Schema.Struct({ sends: Schema.Array(scheduledSendSchema) })

const renderSend = (send: ScheduledSend): string =>
  `${send.id} · ${send.status} · ${new Date(send.sendAt).toISOString()}${send.model === undefined ? '' : ` · ${send.model.model}${send.model.reasoningEffort === undefined ? '' : `/${send.model.reasoningEffort}`}`} · ${send.text.slice(0, 120)}`

/**
 * Messages a person scheduled to send into a thread later. The Host owns them: they survive a restart, each is sent
 * once (its request id makes a retried delivery a no-op), and the dock, the composer's Send later menu and the agent
 * tools all call these methods.
 */
export const scheduledSendApi = defineApi({
  id: 'scheduled-sends',
  version: 1,
  owner: '@dshfiles/queue-reorder',
  methods: {
    list: method({
      input: Schema.Struct({ sessionId: Schema.optional(sessionIdSchema) }),
      output: sendListSchema,
      description:
        'List the messages scheduled to be sent later, soonest first: one thread when sessionId is given, else every thread. Agents default to, and only reach, their own thread and its subagents. Read-only.',
      tool: {
        name: 'scheduled_send_list',
        readOnly: true,
        render: output => (output.sends.length === 0 ? 'No scheduled messages.' : output.sends.map(renderSend).join('\n')),
      },
    }),
    create: method({
      input: Schema.Struct({
        sessionId: Schema.optional(sessionIdSchema),
        text: textSchema,
        sendAt: epochMsSchema,
        model: Schema.optional(sendModelSchema),
      }),
      output: scheduledSendSchema,
      description:
        'Schedule a message to be sent into a thread at sendAt (Unix epoch milliseconds, in the future), as if the user sent it then; with model, the thread switches to that model and effort first. Agents default to their own thread. Call only when the user asked to send something later.',
      tool: { name: 'scheduled_send_create', render: renderSend },
    }),
    update: method({
      input: Schema.Struct({
        id: sendIdSchema,
        text: Schema.optional(textSchema),
        sendAt: Schema.optional(epochMsSchema),
        /** null clears the override so the thread's own model is used. */
        model: Schema.optional(Schema.NullOr(sendModelSchema)),
      }),
      output: scheduledSendSchema,
      description:
        'Change the text, send time, or model and effort of one scheduled message (model null keeps the thread’s own). A failed send is rescheduled. Call only when the user asked to change it.',
      tool: { name: 'scheduled_send_update', render: renderSend },
    }),
    cancel: method({
      input: Schema.Struct({ id: sendIdSchema }),
      output: scheduledSendSchema,
      description:
        'Cancel one scheduled message so it is never sent. Returns it, so it can be scheduled again with scheduled_send_create. Call only when the user asked to cancel it.',
      tool: { name: 'scheduled_send_cancel', render: send => `Cancelled ${renderSend(send)}` },
    }),
    sendNow: method({
      input: Schema.Struct({ id: sendIdSchema }),
      output: scheduledSendSchema,
      description: 'Send one scheduled message now instead of at its time. Call only when the user asked to send it now.',
      tool: { name: 'scheduled_send_now', render: send => `Sending now: ${renderSend(send)}` },
    }),
  },
})
