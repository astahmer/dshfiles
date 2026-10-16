import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const threadSidebarSessionArchiveApi = defineApi({
  id: 'thread-sidebar-session-archive',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    status: method({
      input: z.object({ sessionIds: z.array(z.string().min(1).max(256)).max(10_000) }).strict(),
      output: z.object({ archivedSessionIds: z.array(z.string().min(1).max(256)).max(10_000) }),
      description: 'Return archived membership for the requested Session IDs.',
    }),
  },
})
