import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const threadSidebarMachineApi = defineApi({
  id: 'thread-sidebar-machine',
  version: 1,
  methods: {
    name: method({ input: z.void(), output: z.object({ name: z.string() }) }),
  },
})
