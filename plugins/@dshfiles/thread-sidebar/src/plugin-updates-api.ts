import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const threadSidebarPluginUpdatesApi = defineApi({
  id: 'thread-sidebar-plugin-updates',
  version: 1,
  methods: {
    pending: method({ input: z.void(), output: z.object({ plugins: z.array(z.string()) }) }),
  },
})
