/**
 * The thread list's read and write of the settled (done) threads the Host keeps in its own store (settled-store.ts).
 * Page plumbing only: other plugins settle a thread through the auto-settle API's `requestSettle`, and the Agent through
 * `thread_settle` / `thread_unsettle` (and reads the state with `thread_list`), so these methods have no agent tool.
 */
import { defineApi, event, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))

/** Every settled thread and when it was settled; `revision` moves on each change. */
export const settledSnapshotSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    settledSessionIds: Schema.Array(sessionIdSchema).check(Schema.isMaxLength(50_000)),
    settledAt: Schema.Record(sessionIdSchema, Schema.Number.check(Schema.isFinite())),
    revision: Schema.Number.check(Schema.isFinite()),
  }),
)

/** One change of the settled status: threads to settle (with the instant the page settled them) and to restore. */
export const settledChangeSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    settle: Schema.Record(sessionIdSchema, Schema.NullOr(Schema.Number.check(Schema.isFinite()))),
    unsettle: Schema.Array(sessionIdSchema).check(Schema.isMaxLength(50_000)),
  }),
)

export type SettledChange = Schema.Schema.Type<typeof settledChangeSchema>

export const threadSidebarSettledApi = defineApi({
  id: 'thread-sidebar-settled',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    read: method({
      input: SchemaHelpers.toolInput({}),
      output: settledSnapshotSchema,
      readOnly: true,
      tags: ['settled'],
      description: 'The settled (done) threads and when each was settled, for the thread list. Read-only.',
    }),
    change: method({
      input: settledChangeSchema,
      output: settledSnapshotSchema,
      description: 'Settle and restore threads from the thread list; a thread already settled keeps its first instant.',
    }),
  },
  events: {
    changed: event({
      schema: Schema.Struct({ revision: Schema.Number }),
      invalidates: ['settled'],
      description: 'The settled threads changed; read them again.',
    }),
  },
})
