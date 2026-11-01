import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { networkSaveSchema, networkSnapshotSchema } from './network-api.js'
import { LoopbackContract } from './schema.js'

export const loopbackAccessStatusSchema = Schema.Struct({
  state: Schema.Literals(['starting', 'native-loopback', 'forwarding', 'disabled', 'stopped', 'failed']),
  upstreamOrigin: Schema.NullOr(Schema.String),
  localhostOrigin: Schema.NullOr(Schema.String),
  listeners: Schema.Array(
    Schema.Struct({
      host: Schema.Literals(['127.0.0.1', '::1']),
      port: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(65_535)),
    }),
  ),
})

export type LoopbackAccessStatus = typeof loopbackAccessStatusSchema.Type

export const loopbackAccessApi = defineApi({
  id: 'loopback-access',
  owner: '@dshfiles/loopback-access',
  version: 1,
  methods: {
    network: LoopbackContract.method({
      input: Schema.Void,
      output: networkSnapshotSchema,
      description: 'Read Network access settings, concrete local address choices, actual listening URLs, CLI overrides and pending restart state. Read-only.',
      tool: { name: 'network_access_settings', readOnly: true },
    }),
    saveNetwork: LoopbackContract.method({
      input: networkSaveSchema,
      output: networkSnapshotSchema,
      description:
        'Save validated Network access choices for the next DSH startup without restarting or rebinding the running server. May run only when the user asks to change network settings; expectedRevision prevents overwriting concurrent edits.',
      tool: { name: 'network_access_save', readOnly: false },
    }),
    status: LoopbackContract.method({
      input: Schema.Void,
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
