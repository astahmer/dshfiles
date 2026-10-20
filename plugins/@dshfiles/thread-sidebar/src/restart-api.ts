import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const threadSidebarRestartApi = defineApi({
  id: 'thread-sidebar-restart',
  version: 1,
  methods: {
    availability: method({
      input: z.void(),
      output: z.object({
        available: z.boolean(),
        /** A restart waiting for running turns to finish: since when, and how many turns are still running. */
        pending: z.object({ since: z.number(), running: z.number().int().nonnegative() }).nullable().optional(),
      }),
    }),
    requestRestart: method({ input: z.void(), output: z.object({ accepted: z.literal(true) }) }),
    /** Restart once no turn is running (or after a long wait), so working threads finish instead of being cut off. */
    requestRestartWhenIdle: method({ input: z.void(), output: z.object({ accepted: z.literal(true) }) }),
    cancelPendingRestart: method({ input: z.void(), output: z.object({ canceled: z.boolean() }) }),
    /** The tokenized launch URL the dsh-web supervisor recorded, to hand to an agent or `dshx`. */
    launchUrl: method({ input: z.void(), output: z.object({ url: z.string().nullable() }) }),
  },
})
