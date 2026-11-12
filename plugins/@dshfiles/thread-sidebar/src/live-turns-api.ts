import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

/**
 * The running turns this Host observes: start time and current step, for the thread list's live activity line. `now`
 * is the Host clock at the read, so a browser with a skewed clock still counts elapsed time correctly. Presentation
 * only, so no agent tool: `thread_list` already says which threads run.
 */
export const threadSidebarLiveTurnsApi = defineApi({
  id: 'thread-sidebar-live-turns',
  version: 1,
  methods: {
    list: method({
      description: 'Running turns on this Host with their start time and current step, for the thread list.',
      input: Schema.Void,
      output: SchemaHelpers.strictStruct(
        Schema.Struct({
          turns: Schema.Array(
            Schema.Struct({
              sessionId: Schema.String,
              startedAt: Schema.Number,
              step: Schema.NullOr(Schema.String),
            }),
          ),
          now: Schema.Number,
        }),
      ),
    }),
  },
})
