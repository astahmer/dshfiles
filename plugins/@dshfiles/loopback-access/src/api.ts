import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const loopbackAccessStatusSchema = z.object({
  state: z.enum(['starting', 'native-loopback', 'forwarding', 'stopped', 'failed']),
  upstreamOrigin: z.string().nullable(),
  localhostOrigin: z.string().nullable(),
  listeners: z.array(z.object({ host: z.enum(['127.0.0.1', '::1']), port: z.number().int().min(1).max(65535) })),
})

export type LoopbackAccessStatus = z.infer<typeof loopbackAccessStatusSchema>

export const loopbackAccessApi = defineApi({
  id: 'loopback-access',
  owner: '@dshfiles/loopback-access',
  version: 1,
  methods: {
    status: method({
      input: z.void(),
      output: loopbackAccessStatusSchema,
      description: 'Read whether the LAN-bound DSH also has localhost access, its non-secret origins and actual loopback listeners. Read-only.',
      tool: {
        name: 'loopback_access_status',
        readOnly: true,
        render: status => `${status.state}${status.localhostOrigin === null ? '' : `: ${status.localhostOrigin}`}`,
      },
    }),
  },
})
