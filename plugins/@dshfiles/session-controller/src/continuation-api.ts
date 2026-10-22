import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/** Fork one thread into another project, where its directory becomes the new thread's own working directory. */
export const continuationApi = defineApi({
  id: 'session-continuation',
  owner: '@dshfiles/session-controller',
  version: 1,
  methods: {
    continueIn: method({
      description:
        'Fork one thread into the registered project (DSH Workspace) given by workspaceId: the new thread runs in that directory and is accounted to it. includeOpenTurn cuts after the newest event instead of at the latest completed turn.',
      input: z
        .object({
          sessionId: z.string().min(1).max(256),
          workspaceId: z.string().min(1).max(256),
          includeOpenTurn: z.boolean(),
        })
        .strict(),
      output: z.object({ sessionId: z.string() }).strict(),
    }),
  },
})
