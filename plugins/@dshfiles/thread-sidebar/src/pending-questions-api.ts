import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { SchemaHelpers } from './schema-helpers.js'

export const threadSidebarPendingQuestionsApi = defineApi({
  id: 'thread-sidebar-pending-questions',
  version: 1,
  methods: {
    active: method({
      input: SchemaHelpers.strictStruct(
        Schema.Struct({ sessionIds: Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256))).check(Schema.isMaxLength(500)) }),
      ),
      output: SchemaHelpers.strictStruct(Schema.Struct({ sessionIds: Schema.Array(Schema.String) })),
    }),
  },
})
