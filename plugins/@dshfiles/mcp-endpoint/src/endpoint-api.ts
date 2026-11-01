import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

export const endpointStatusSchema = Schema.Struct({
  path: Schema.String,
  localUrl: Schema.NullOr(Schema.String),
  lanUrl: Schema.NullOr(Schema.String),
  lanEnabled: Schema.Boolean,
  token: Schema.NullOr(Schema.Struct({ createdAt: Schema.Number })),
})

export type EndpointStatus = typeof endpointStatusSchema.Type

const ONLY_WHEN_ASKED = 'Call only when the user asked for this.'

/** The MCP endpoint's settings: its URLs, whether a token exists, and whether other machines may connect. */
export const mcpEndpointApi = defineApi({
  id: 'mcp-endpoint',
  version: 1,
  owner: '@dshfiles/mcp-endpoint',
  methods: {
    status: method({
      description: 'The MCP endpoint path and URLs, whether a bearer token exists (never the token) and whether LAN clients may connect. Read-only.',
      input: Schema.Record(Schema.String, Schema.Never),
      output: endpointStatusSchema,
      readOnly: true,
      tool: { name: 'mcp_endpoint_status', readOnly: true },
    }),
    rotateToken: method({
      description: 'Issue a new bearer token, replacing the previous one, and return it once. Only its hash is kept.',
      input: Schema.Record(Schema.String, Schema.Never),
      output: Schema.Struct({ token: Schema.String, status: endpointStatusSchema }),
    }),
    revokeToken: method({
      description: `Delete the bearer token so every MCP client is refused until a new one is issued in Settings › MCP endpoint. ${ONLY_WHEN_ASKED}`,
      input: Schema.Struct({ confirm: Schema.Literal(true) }),
      output: endpointStatusSchema,
      tool: { name: 'mcp_endpoint_revoke_token', readOnly: false },
    }),
    setLanAccess: method({
      description: `Allow or refuse MCP clients on other machines; this machine is always allowed. ${ONLY_WHEN_ASKED}`,
      input: Schema.Struct({ enabled: Schema.Boolean }),
      output: endpointStatusSchema,
      tool: { name: 'mcp_endpoint_set_lan_access', readOnly: false },
    }),
  },
})
