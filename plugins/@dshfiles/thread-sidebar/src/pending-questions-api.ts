import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const threadSidebarPendingQuestionsApi = defineApi({
  id: 'thread-sidebar-pending-questions',
  version: 1,
  methods: {
    active: method({
      input: z.object({ sessionIds: z.array(z.string().min(1).max(256)).max(500) }).strict(),
      output: z.object({ sessionIds: z.array(z.string()) }).strict(),
    }),
  },
})
