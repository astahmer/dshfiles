import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { Context, Effect, Layer, Option, Schema } from 'effect'
import { notificationHistoryEntrySchema, notificationHistorySnapshotSchema, type NotificationHistoryEntry } from './notification-history-api.js'
import { SchemaHelpers } from './schema-helpers.js'

type Snapshot = typeof notificationHistorySnapshotSchema.Type
type RecordInput = Pick<NotificationHistoryEntry, 'id' | 'sessionId' | 'at' | 'category'>

const storedSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    version: Schema.Literal(1),
    entries: Schema.Array(SchemaHelpers.strictStruct(notificationHistoryEntrySchema)).check(Schema.isMaxLength(500)),
  }),
)

const recordSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    id: notificationHistoryEntrySchema.fields.id,
    sessionId: notificationHistoryEntrySchema.fields.sessionId,
    at: notificationHistoryEntrySchema.fields.at,
    category: notificationHistoryEntrySchema.fields.category,
  }),
)
const decodeRecord = Schema.decodeUnknownEffect(recordSchema)

const historyDomain = defineDomain({
  name: 'thread_notification_history',
  version: 1,
  tables: { snapshot: { valueSchema: zodSchemaFromEffect(storedSchema), __key: 'snapshot' } },
})

export class NotificationHistoryFailed extends Schema.TaggedError<NotificationHistoryFailed>()(
  'NotificationHistoryFailed',
  { operation: Schema.Literals(['open', 'read', 'record', 'read-state', 'dismiss', 'clear']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'notification-history-failed' },
) {
  override get message(): string {
    return `Notification history could not ${this.operation}. Retry after checking the Host storage diagnostics; the previous history is unchanged.`
  }
}

export class NotificationHistory extends Context.Service<
  NotificationHistory,
  {
    readonly snapshot: Effect.Effect<Snapshot, NotificationHistoryFailed>
    readonly record: (input: RecordInput) => Effect.Effect<void, NotificationHistoryFailed>
    readonly setRead: (input: { readonly ids: readonly string[]; readonly read: boolean }) => Effect.Effect<Snapshot, NotificationHistoryFailed>
    readonly setDismissed: (input: { readonly id: string; readonly dismissed: boolean }) => Effect.Effect<Snapshot, NotificationHistoryFailed>
    readonly clear: (input: { readonly ids: readonly string[]; readonly confirm: true }) => Effect.Effect<Snapshot, NotificationHistoryFailed>
  }
>()('@dshfiles/thread-sidebar/NotificationHistory') {
  static readonly layer = Layer.effect(
    NotificationHistory,
    Effect.gen(function* () {
      const domain = yield* (yield* StorageDomain)
        .open(historyDomain)
        .pipe(Effect.mapError(cause => new NotificationHistoryFailed({ operation: 'open', cause })))
      const table = domain.table('snapshot')
      const snapshot = table.get('snapshot').pipe(
        Effect.map(value => ({ entries: Option.isSome(value) ? value.value.entries : [] })),
        Effect.mapError(cause => new NotificationHistoryFailed({ operation: 'read', cause })),
      )
      const change = (input: {
        readonly operation: NotificationHistoryFailed['operation']
        readonly update: (entries: Snapshot['entries']) => Snapshot['entries']
      }) =>
        domain
          .withWriteLock(
            Effect.gen(function* () {
              const current = yield* snapshot
              const entries = input.update(current.entries)
              if (entries.length === current.entries.length && entries.every((entry, index) => entry === current.entries[index])) return current
              yield* table.put('snapshot', { version: 1, entries })
              return { entries }
            }).pipe(Effect.uninterruptible),
          )
          .pipe(Effect.mapError(cause => new NotificationHistoryFailed({ operation: input.operation, cause })))

      return NotificationHistory.of({
        snapshot,
        record: Effect.fn('notification history record')(function* (input) {
          const record = yield* decodeRecord(input).pipe(Effect.mapError(cause => new NotificationHistoryFailed({ operation: 'record', cause })))
          yield* change({
            operation: 'record',
            update: entries => {
              if (entries.some(entry => entry.id === record.id)) return entries
              return [...entries, { ...record, read: false, dismissed: false }]
                .sort((left, right) => right.at - left.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
                .slice(0, 500)
            },
          })
        }),
        setRead: input => {
          const ids = new Set(input.ids)
          return change({
            operation: 'read-state',
            update: entries => entries.map(entry => (ids.has(entry.id) && entry.read !== input.read ? { ...entry, read: input.read } : entry)),
          })
        },
        setDismissed: input =>
          change({
            operation: 'dismiss',
            update: entries =>
              entries.map(entry => (entry.id === input.id && entry.dismissed !== input.dismissed ? { ...entry, dismissed: input.dismissed } : entry)),
          }),
        clear: input => {
          const ids = new Set(input.ids)
          return change({ operation: 'clear', update: entries => entries.filter(entry => !ids.has(entry.id)) })
        },
      })
    }),
  )
}
