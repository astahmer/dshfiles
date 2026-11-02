import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

export const threadSidebarMachineApi = defineApi({
  id: 'thread-sidebar-machine',
  version: 1,
  methods: {
    name: method({ input: Schema.Void, output: Schema.Struct({ name: Schema.String }) }),
  },
})
