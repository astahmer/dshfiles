import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

export const endpointStatusSchema = z
  .object({
    path: z.string(),
    localUrl: z.string().nullable(),
    lanUrl: z.string().nullable(),
    lanEnabled: z.boolean(),
    token: z.object({ createdAt: z.number() }).strict().nullable(),
  })
  .strict()

export type EndpointStatus = z.infer<typeof endpointStatusSchema>

const ONLY_WHEN_ASKED = 'Call only when the user asked for this.'

/** The MCP endpoint's settings: its URLs, whether a token exists, and whether other machines may connect. */
export const mcpEndpointApi = defineApi({
  id: 'mcp-endpoint',
  version: 1,
  owner: '@dshfiles/mcp-endpoint',
  methods: {
    status: method({
      description: 'The MCP endpoint path and URLs, whether a bearer token exists (never the token) and whether LAN clients may connect. Read-only.',
      input: z.object({}).strict(),
      output: endpointStatusSchema,
      readOnly: true,
      tool: { name: 'mcp_endpoint_status', readOnly: true },
    }),
    rotateToken: method({
      description: 'Issue a new bearer token, replacing the previous one, and return it once. Only its hash is kept.',
      input: z.object({}).strict(),
      output: z.object({ token: z.string(), status: endpointStatusSchema }).strict(),
    }),
    revokeToken: method({
      description: `Delete the bearer token so every MCP client is refused until a new one is issued in Settings › MCP endpoint. ${ONLY_WHEN_ASKED}`,
      input: z.object({ confirm: z.literal(true) }).strict(),
      output: endpointStatusSchema,
      tool: { name: 'mcp_endpoint_revoke_token', readOnly: false },
    }),
    setLanAccess: method({
      description: `Allow or refuse MCP clients on other machines; this machine is always allowed. ${ONLY_WHEN_ASKED}`,
      input: z.object({ enabled: z.boolean() }).strict(),
      output: endpointStatusSchema,
      tool: { name: 'mcp_endpoint_set_lan_access', readOnly: false },
    }),
  },
})
