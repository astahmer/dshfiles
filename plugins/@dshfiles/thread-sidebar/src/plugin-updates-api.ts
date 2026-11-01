import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

/** One client bundle a page loaded: its entry id and the revision that page runs. */
const pageRevisionSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
  rev: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
})

export const threadSidebarPluginUpdatesApi = defineApi({
  id: 'thread-sidebar-plugin-updates',
  version: 1,
  methods: {
    pending: method({ input: Schema.Void, output: Schema.Struct({ plugins: Schema.Array(Schema.String) }) }),
    /**
     * Which of the page's loaded client bundles the Host no longer serves, so only a page
     * reload applies them. The page sends the revisions it actually runs; a rebuild it
     * already picked up over HMR reports the current revision and drops off the answer.
     */
    clientUpdates: method({
      input: Schema.Struct({ revisions: Schema.Array(pageRevisionSchema).check(Schema.isMaxLength(500)) }),
      output: Schema.Struct({ stale: Schema.Array(Schema.String), added: Schema.Array(Schema.String) }),
    }),
  },
})
