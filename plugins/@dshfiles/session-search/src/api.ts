import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { indexHealthSchema } from './protocol.js'

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

/**
 * The one user-visible capability this plugin adds on top of search itself: the state of its own derived index. Every
 * method is a read, and each carries the matching agent tool.
 */
export const sessionSearchApi = defineApi({
  id: 'session-search',
  version: 1,
  owner: '@dshfiles/session-search',
  methods: {
    health: method({
      input: z.object({}).strict(),
      output: indexHealthSchema.extend({ ownsService: z.boolean() }),
      description:
        'Read the owned session-search index health: indexed sessions and documents, index bytes, how many log sessions and bytes are still behind, whether an ingest pass is running, how long the last pass took, and the last error. `ownsService` is false when another plugin owns the sessionQuery service, in which case content search runs on that backend and these counters stay zero. Read-only.',
      tool: { name: 'session_search_health', readOnly: true, render: compactJson },
    }),
  },
})
