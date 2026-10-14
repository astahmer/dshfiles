import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const settingsShellApi = defineApi({
  id: 'settings-shell',
  version: 1,
  methods: {
    /** The profile document `Open configuration file` opens, so the Client can copy, reveal or open it elsewhere. */
    documentPath: method({ input: z.void(), output: z.object({ path: z.string().nullable() }) }),
    /** The native Settings package version the running DSH ships, against the version this shell was ported from. */
    upstream: method({
      input: z.void(),
      output: z.object({ portedFrom: z.string(), installed: z.string().nullable(), stale: z.boolean() }),
    }),
  },
})
