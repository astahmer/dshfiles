import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const agentToolkitApi = defineApi({
  id: 'agent-toolkit',
  version: 1,
  owner: '@dshfiles/agent-toolkit',
  methods: {
    versions: method({
      input: z.object({ packages: z.array(z.string().min(1).max(240)).max(500) }).strict(),
      output: z.record(z.string(), z.string().nullable()),
      description: 'The installed version of each package as the current DSH profile resolves it; null when it cannot be found.',
    }),
  },
})
