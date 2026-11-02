import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

/** Reasons a finished turn counts as attention worth surfacing. */
export const ATTENTION_FINISH_REASONS = ['completed', 'aborted', 'blocked', 'error', 'max-tokens'] as const

export type AttentionFinishReason = (typeof ATTENTION_FINISH_REASONS)[number]

export const MAX_ATTENTION_SESSIONS = 2000

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128))
const timestampSchema = Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))

/**
 * One session with unacknowledged attention. Presence in a snapshot *is* the
 * unread signal, so acknowledging removes the record instead of keeping a
 * comparison row.
 */
export const threadAttentionViewSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    sessionId: sessionIdSchema,
    /** Record version; a stale acknowledge never clears a finish recorded after it. */
    version: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThan(0)),
    /** When the newest finished turn ended; null for a thread only marked unread by hand. */
    finishedAt: Schema.NullOr(timestampSchema),
    finishedSeq: Schema.NullOr(Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
    finishedReason: Schema.NullOr(Schema.Literals(ATTENTION_FINISH_REASONS)),
    manuallyUnread: Schema.Boolean,
  }),
)

export const threadAttentionSnapshotSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    /** Monotone across Host restarts so a stale read never replaces a newer write. */
    revision: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThan(0)),
    sessions: Schema.Array(threadAttentionViewSchema).check(Schema.isMaxLength(MAX_ATTENTION_SESSIONS)),
  }),
)

/** Browser state carried over once, when this plugin starts owning the record on the Host. */
export const threadAttentionMigrationEntrySchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    sessionId: sessionIdSchema,
    finishedAt: Schema.NullOr(timestampSchema),
    manuallyUnread: Schema.Boolean,
  }),
)

export const threadSidebarAttentionApi = defineApi({
  id: 'thread-sidebar-attention',
  version: 1,
  // Other plugins import this contract; without an owner each would derive its own channel.
  owner: '@dshfiles/thread-sidebar',
  methods: {
    state: method({
      input: Schema.Void,
      output: threadAttentionSnapshotSchema,
      description: 'Threads whose finished turn (or manual unread mark) the user has not acknowledged yet. Read-only.',
      tool: { name: 'thread_attention_state', readOnly: true },
    }),
    acknowledge: method({
      input: SchemaHelpers.strictStruct(
        Schema.Struct({ sessionId: sessionIdSchema, version: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThan(0)) }),
      ),
      output: threadAttentionSnapshotSchema,
      description: 'Acknowledge the finished turn of one thread up to the record version the caller saw. A manual unread mark on the same thread survives.',
    }),
    clearUnread: method({
      input: SchemaHelpers.strictStruct(
        Schema.Struct({ sessionId: sessionIdSchema, version: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThan(0)) }),
      ),
      output: threadAttentionSnapshotSchema,
      description: 'Drop every attention record for one thread, as when the user opens it.',
    }),
    clearUnreadMany: method({
      input: SchemaHelpers.strictStruct(
        Schema.Struct({
          entries: Schema.Array(
            SchemaHelpers.strictStruct(
              Schema.Struct({
                sessionId: sessionIdSchema,
                version: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThan(0)),
              }),
            ),
          ).check(Schema.isMaxLength(MAX_ATTENTION_SESSIONS)),
        }),
      ),
      output: threadAttentionSnapshotSchema,
      description: 'Drop the attention records for many threads in one request, without clearing records newer than the caller saw.',
    }),
    markUnread: method({
      input: SchemaHelpers.strictStruct(Schema.Struct({ sessionId: sessionIdSchema })),
      output: threadAttentionSnapshotSchema,
      description: 'Mark one thread unread by hand; the mark persists until the thread is opened or acknowledged.',
    }),
    markUnreadMany: method({
      input: SchemaHelpers.strictStruct(Schema.Struct({ sessionIds: Schema.Array(sessionIdSchema).check(Schema.isMaxLength(MAX_ATTENTION_SESSIONS)) })),
      output: threadAttentionSnapshotSchema,
      description: 'Mark many threads unread by hand in one request; existing finish records are preserved.',
    }),
    migrate: method({
      input: SchemaHelpers.strictStruct(
        Schema.Struct({ entries: Schema.Array(threadAttentionMigrationEntrySchema).check(Schema.isMaxLength(MAX_ATTENTION_SESSIONS)) }),
      ),
      output: threadAttentionSnapshotSchema,
      description: 'Adopt browser-held attention records once, after this Host took ownership of them.',
    }),
  },
})

export type ThreadAttentionView = Schema.Schema.Type<typeof threadAttentionViewSchema>
export type ThreadAttentionSnapshot = Schema.Schema.Type<typeof threadAttentionSnapshotSchema>
export type ThreadAttentionMigrationEntry = Schema.Schema.Type<typeof threadAttentionMigrationEntrySchema>
