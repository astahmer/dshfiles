import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

export const threadSidebarSessionArchiveApi = defineApi({
  id: 'thread-sidebar-session-archive',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    status: method({
      input: SchemaHelpers.strictStruct(
        Schema.Struct({
          sessionIds: Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))).check(Schema.isMaxLength(10_000)),
        }),
      ),
      output: Schema.Struct({
        archivedSessionIds: Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))).check(Schema.isMaxLength(10_000)),
      }),
      description: 'Return archived membership for the requested Session IDs.',
    }),
  },
})
