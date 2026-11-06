import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))
const timestamp = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(8_640_000_000_000_000))
const category = Schema.Literals(['approval-needed', 'input-needed', 'turn-finished', 'stopped', 'failed'])
const ids = Schema.Array(identifier).check(Schema.isMaxLength(500))

export const notificationHistoryEntrySchema = Schema.Struct({
  id: identifier,
  sessionId: identifier,
  at: timestamp,
  category,
  read: Schema.Boolean,
  dismissed: Schema.Boolean,
})

export type NotificationHistoryEntry = typeof notificationHistoryEntrySchema.Type

export const notificationHistorySnapshotSchema = Schema.Struct({
  entries: Schema.Array(notificationHistoryEntrySchema).check(Schema.isMaxLength(500)),
})

export const notificationHistoryApi = defineApi({
  id: 'thread-notification-history',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    list: method({
      input: Schema.Struct({}),
      output: notificationHistorySnapshotSchema,
      description:
        'Read the last 500 retained thread notifications, newest first, including read and dismissed entries. Summaries are fixed categories, never conversation contents. Read-only.',
      tool: { name: 'notification_history_list', readOnly: true, render: result => JSON.stringify(result) },
    }),
    setRead: method({
      input: Schema.Struct({ ids, read: Schema.Boolean }),
      output: notificationHistorySnapshotSchema,
      description: 'Mark the specified notification entries read or unread, without acknowledging or changing their threads. Call only when the user asked.',
      tool: { name: 'notification_history_set_read', render: result => JSON.stringify(result) },
    }),
    setDismissed: method({
      input: Schema.Struct({ id: identifier, dismissed: Schema.Boolean }),
      output: notificationHistorySnapshotSchema,
      description:
        'Dismiss a notification entry or restore it with dismissed:false. This does not stop, resolve or acknowledge its thread. Call only when the user asked.',
      tool: { name: 'notification_history_set_dismissed', render: result => JSON.stringify(result) },
    }),
    clear: method({
      input: Schema.Struct({ ids, confirm: Schema.Literal(true) }),
      output: notificationHistorySnapshotSchema,
      description:
        'Permanently clear only the specified retained notification entries. Read the list first; newer arrivals are preserved. Requires confirm:true. Call only when the user asked to clear notification history.',
      tool: { name: 'notification_history_clear', render: result => JSON.stringify(result) },
    }),
  },
})
