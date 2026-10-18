import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/** One client bundle a page loaded: its entry id and the revision that page runs. */
const pageRevisionSchema = z.object({ id: z.string().min(1).max(256), rev: z.string().min(1).max(256) })

export const threadSidebarPluginUpdatesApi = defineApi({
  id: 'thread-sidebar-plugin-updates',
  version: 1,
  methods: {
    pending: method({ input: z.void(), output: z.object({ plugins: z.array(z.string()) }) }),
    /**
     * Which of the page's loaded client bundles the Host no longer serves, so only a page
     * reload applies them. The page sends the revisions it actually runs; a rebuild it
     * already picked up over HMR reports the current revision and drops off the answer.
     */
    clientUpdates: method({
      input: z.object({ revisions: z.array(pageRevisionSchema).max(500) }),
      output: z.object({ stale: z.array(z.string()), added: z.array(z.string()) }),
    }),
  },
})
