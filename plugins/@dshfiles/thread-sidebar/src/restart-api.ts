import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const threadSidebarRestartApi = defineApi({
  id: 'thread-sidebar-restart',
  version: 1,
  methods: {
    availability: method({ input: z.void(), output: z.object({ available: z.boolean() }) }),
    requestRestart: method({ input: z.void(), output: z.object({ accepted: z.literal(true) }) }),
    /** The tokenized launch URL the dsh-web supervisor recorded, to hand to an agent or `dshx`. */
    launchUrl: method({ input: z.void(), output: z.object({ url: z.string().nullable() }) }),
  },
})
