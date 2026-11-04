import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

export const threadSidebarRestartApi = defineApi({
  id: 'thread-sidebar-restart',
  version: 1,
  methods: {
    availability: method({
      input: Schema.Void,
      output: Schema.Struct({
        available: Schema.Boolean,
        /** This Host process; a new value after a restart tells the page the new Host is up. Absent on older Hosts. */
        run: Schema.optional(Schema.String),
        /** A restart waiting for running turns to finish: since when, and how many turns are still running. */
        pending: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              since: Schema.Number.check(Schema.isFinite()),
              running: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
            }),
          ),
        ),
      }),
    }),
    requestRestart: method({ input: Schema.Void, output: Schema.Struct({ accepted: Schema.Literal(true) }) }),
    /** Restart once no turn is running (or after a long wait), so working threads finish instead of being cut off. */
    requestRestartWhenIdle: method({ input: Schema.Void, output: Schema.Struct({ accepted: Schema.Literal(true) }) }),
    cancelPendingRestart: method({ input: Schema.Void, output: Schema.Struct({ canceled: Schema.Boolean }) }),
    /** The tokenized launch URL the dsh-web supervisor recorded, to hand to an agent or `dshx`. */
    launchUrl: method({ input: Schema.Void, output: Schema.Struct({ url: Schema.NullOr(Schema.String) }) }),
  },
})
