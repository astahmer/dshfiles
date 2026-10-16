import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const sessionIdInput = z.object({ sessionId: z.string().min(1).max(256) }).strict()

export const threadSidebarRecoveryApi = defineApi({
  id: 'thread-sidebar-recovery',
  version: 1,
  methods: {
    pending: method({ input: z.void(), output: z.object({ sessionIds: z.array(z.string().min(1).max(256)).max(5000) }) }),
    resume: method({ input: sessionIdInput, output: z.object({ accepted: z.boolean() }) }),
    dismiss: method({ input: sessionIdInput, output: z.object({ dismissed: z.boolean() }) }),
  },
})
