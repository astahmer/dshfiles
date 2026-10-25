import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { networkSaveSchema, networkSnapshotSchema } from './network-api.js'

export const loopbackAccessStatusSchema = z.object({
  state: z.enum(['starting', 'native-loopback', 'forwarding', 'disabled', 'stopped', 'failed']),
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
    network: method({
      input: z.void(),
      output: networkSnapshotSchema,
      description: 'Read Network access settings, concrete local address choices, actual listening URLs, CLI overrides and pending restart state. Read-only.',
      tool: { name: 'network_access_settings', readOnly: true },
    }),
    saveNetwork: method({
      input: networkSaveSchema,
      output: networkSnapshotSchema,
      description:
        'Save validated Network access choices for the next DSH startup without restarting or rebinding the running server. May run only when the user asks to change network settings; expectedRevision prevents overwriting concurrent edits.',
      tool: { name: 'network_access_save', readOnly: false },
    }),
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
