import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { PROVIDERS } from './catalog.js'

export const referenceNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(128)
const envNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(128)
const headerNameSchema = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  .max(128)
const refsSchema = (key: typeof envNameSchema | typeof headerNameSchema) =>
  z.record(key, referenceNameSchema).refine(record => Object.keys(record).length <= 32)
const absolutePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    value => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value),
    'Use an absolute working directory for the local start command.',
  )
const localStartSchema = z
  .object({
    command: z.string().min(1).max(2048),
    args: z.array(z.string().max(4096)).max(128),
    cwd: absolutePathSchema,
    envRefs: refsSchema(envNameSchema),
  })
  .strict()
const localStartDraftSchema = z
  .object({
    commandLine: z.string().min(1).max(8192),
    cwd: absolutePathSchema,
    envRefs: refsSchema(envNameSchema),
  })
  .strict()

const endpointWith = (allowLoopbackHttp: boolean) =>
  z
    .string()
    .url()
    .max(2048)
    .refine(value => {
      try {
        const url = new URL(value)
        const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
        const secure = url.protocol === 'https:' || (allowLoopbackHttp && url.protocol === 'http:' && loopback)
        return secure && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
      } catch {
        return false
      }
    }, 'Use an HTTPS endpoint without embedded credentials.')

/** A catalog or Registry entry: always HTTPS. */
const endpointSchema = endpointWith(false)
/** A server the user registers may also be plain HTTP on this machine: a local MCP server or the helper an entry starts. */
const serverEndpointSchema = endpointWith(true)

const authSchema = z.enum(['none', 'oauth'])

const baseDraft = {
  id: z.string().max(80),
  name: z.string().trim().min(1).max(120),
  serverName: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  enabled: z.boolean(),
}

export const storedServerSchema = z.discriminatedUnion('transport', [
  z
    .object({
      ...baseDraft,
      transport: z.literal('stdio'),
      command: z.string().min(1).max(2048),
      args: z.array(z.string().max(4096)).max(128),
      cwd: z.string().max(2048),
      envRefs: refsSchema(envNameSchema),
    })
    .strict(),
  z
    .object({
      ...baseDraft,
      transport: z.literal('streamable-http'),
      url: serverEndpointSchema,
      headerRefs: refsSchema(headerNameSchema),
      auth: authSchema.optional(),
      startCommand: localStartSchema.optional(),
    })
    .strict(),
])

export const serverDraftSchema = z.discriminatedUnion('transport', [
  z
    .object({
      ...baseDraft,
      id: z.string().max(80),
      transport: z.literal('stdio'),
      commandLine: z.string().min(1).max(8192),
      cwd: z.string().max(2048),
      envRefs: refsSchema(envNameSchema),
    })
    .strict(),
  z
    .object({
      ...baseDraft,
      id: z.string().max(80),
      transport: z.literal('streamable-http'),
      url: serverEndpointSchema,
      headerRefs: refsSchema(headerNameSchema),
      auth: authSchema.optional(),
      startCommand: localStartDraftSchema.nullable().optional(),
    })
    .strict(),
])

const oauthStateSchema = z.enum(['not-used', 'signed-in', 'needs-sign-in'])

export const serverViewSchema = z.discriminatedUnion('transport', [
  z.object({
    id: z.string(),
    name: z.string(),
    serverName: z.string(),
    enabled: z.boolean(),
    transport: z.literal('stdio'),
    commandLine: z.string(),
    cwd: z.string(),
    credentialReferences: z.array(z.object({ target: z.string(), reference: z.string(), configured: z.boolean() })),
    configuration: z.enum(['ready', 'needs-credentials']),
    clientLifecycle: z.enum(['inactive', 'starting', 'loaded', 'start-failed', 'manually-disconnected']),
    localProcess: z.enum(['not-configured', 'starting', 'running', 'exited', 'stopping', 'stopped', 'stop-unconfirmed']),
    connectionHealth: z.literal('not-reported'),
    registeredToolCount: z.number().int().nonnegative(),
    oauth: oauthStateSchema.default('not-used'),
  }),
  z.object({
    id: z.string(),
    name: z.string(),
    serverName: z.string(),
    enabled: z.boolean(),
    transport: z.literal('streamable-http'),
    url: z.string(),
    credentialReferences: z.array(z.object({ target: z.string(), reference: z.string(), configured: z.boolean() })),
    configuration: z.enum(['ready', 'needs-credentials']),
    clientLifecycle: z.enum(['inactive', 'starting', 'loaded', 'start-failed', 'manually-disconnected']),
    localProcess: z.enum(['not-configured', 'starting', 'running', 'exited', 'stopping', 'stopped', 'stop-unconfirmed']),
    startCommand: z.object({ commandLine: z.string(), cwd: z.string() }).optional(),
    connectionHealth: z.literal('not-reported'),
    registeredToolCount: z.number().int().nonnegative(),
    oauth: oauthStateSchema.default('not-used'),
  }),
])

export const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string(),
  url: endpointSchema,
  auth: z.enum(['oauth', 'none', 'token']),
  docsUrl: z.string().url(),
})

export const registryEntrySchema = z.object({
  name: z.string(),
  title: z.string(),
  category: z.string(),
  description: z.string(),
  version: z.string(),
  endpoint: endpointSchema.nullable(),
  docsUrl: z.string().url().nullable(),
})

/** The four manager preferences, stored beside the server list in the Loader row; each field falls back on its own. */
export const preferencesSchema = z.object({
  connectOnStartup: z.boolean().catch(true),
  toolCallTimeoutSeconds: z.number().int().min(5).max(600).catch(30),
  registrySearch: z.boolean().catch(true),
  oauthClientName: z.string().trim().min(1).max(120).catch('DSH MCP servers'),
})

/** What a save must satisfy: unlike stored values, an invalid field is refused instead of reset. */
export const preferencesInputSchema = z.object({
  connectOnStartup: z.boolean(),
  toolCallTimeoutSeconds: z.number().int().min(5).max(600),
  registrySearch: z.boolean(),
  oauthClientName: z.string().trim().min(1).max(120),
})

export const snapshotSchema = z.object({
  servers: z.array(serverViewSchema),
  providers: z.array(providerSchema),
  connectionHealth: z.literal('not-reported'),
  registrySearch: z.boolean(),
  preferences: preferencesInputSchema,
})

/**
 * Client boundary decode. A Host that predates a field (the live DSH keeps the
 * old Host until restart) still yields a complete snapshot: missing fields take
 * defaults, and a provider list without endpoints falls back to the bundled catalog.
 */
const compatibleSnapshotSchema = z.object({
  servers: z.array(serverViewSchema).catch([]),
  providers: z.array(providerSchema).catch(() => [...PROVIDERS]),
  connectionHealth: z.literal('not-reported').catch('not-reported'),
  registrySearch: z.boolean().catch(true),
  preferences: preferencesSchema.catch(() => preferencesSchema.parse({})),
})

export const decodeSnapshot = (raw: unknown): ManagerSnapshot => compatibleSnapshotSchema.parse(raw ?? {})

export type StoredServer = z.infer<typeof storedServerSchema>
export type ServerDraft = z.infer<typeof serverDraftSchema>
export type ServerView = z.infer<typeof serverViewSchema>
export type RegistryEntry = z.infer<typeof registryEntrySchema>
export type ManagerSnapshot = z.infer<typeof snapshotSchema>
export type ManagerPreferences = z.infer<typeof preferencesInputSchema>

/** Model-facing one-server line. */
const serverLine = (server: ManagerSnapshot['servers'][number]): string =>
  `${server.id} · ${server.name} · ${server.transport} · ${server.enabled ? 'enabled' : 'disabled'} · ${server.clientLifecycle} · ${String(server.registeredToolCount)} tool(s)${server.configuration === 'ready' ? '' : ` · ${server.configuration}`}`

/** Model-facing summary of a manager snapshot, so a tool result is the servers and preferences rather than every provider row. */
const summarizeSnapshot = (snapshot: ManagerSnapshot): string =>
  [
    snapshot.servers.length === 0 ? 'No MCP servers configured.' : snapshot.servers.map(serverLine).join('\n'),
    `preferences: connect on startup ${String(snapshot.preferences.connectOnStartup)}, tool timeout ${String(snapshot.preferences.toolCallTimeoutSeconds)}s, registry search ${String(snapshot.preferences.registrySearch)}, OAuth client ${snapshot.preferences.oauthClientName}`,
  ].join('\n')

/** Model-facing registry search result. */
const summarizeRegistry = (entries: readonly RegistryEntry[]): string =>
  entries
    .map(entry => `${entry.name} · ${entry.title} · ${entry.category} · v${entry.version}${entry.endpoint === null ? '' : ` · ${entry.endpoint}`}`)
    .join('\n') || 'No MCP registry entry matched.'

export const mcpServersApi = defineApi({
  id: 'mcp-servers',
  owner: '@dshfiles/mcp-servers',
  version: 1,
  methods: {
    list: method({
      input: z.void(),
      output: snapshotSchema,
      description:
        'Every MCP server configured in this profile with its transport, whether it is enabled, its client lifecycle and how many tools it registered. Read-only.',
      tool: { name: 'mcp_list_servers', readOnly: true, render: summarizeSnapshot },
    }),
    refresh: method({
      input: z.void(),
      output: snapshotSchema,
      description:
        'Reconcile the native MCP clients with the stored server list and report the result, for example after the profile changed outside this DSH. Call only when the user asked to refresh the servers.',
      tool: { name: 'mcp_refresh_servers', render: summarizeSnapshot },
    }),
    save: method({
      input: z.object({ server: serverDraftSchema }),
      output: snapshotSchema,
      description:
        'Add or edit one MCP server in the profile: stdio with a command line, environment references and a working directory, or streamable HTTP with a URL, header references, optional auth and a local start command. Call only when the user asked for that change.',
      tool: { name: 'mcp_save_server', render: summarizeSnapshot },
    }),
    setEnabled: method({
      input: z.object({ id: z.string().min(1).max(80), enabled: z.boolean() }),
      output: snapshotSchema,
      description: 'Enable or disable one MCP server in the profile without removing it. Call only when the user asked to enable or disable that server.',
      tool: { name: 'mcp_set_server_enabled', render: summarizeSnapshot },
    }),
    setConnection: method({
      input: z.object({ id: z.string().min(1).max(80), connected: z.boolean() }),
      output: snapshotSchema,
      description:
        'Connect or disconnect one MCP server native client in this Host process without changing its saved enabled state. Call only when the user asked to connect or disconnect it.',
      tool: { name: 'mcp_set_connection', render: summarizeSnapshot },
    }),
    remove: method({
      input: z.object({ id: z.string().min(1).max(80) }),
      output: snapshotSchema,
      description: 'Remove one MCP server from the profile, including its stored OAuth grant. Call only when the user asked to remove that server.',
      tool: { name: 'mcp_remove_server', render: summarizeSnapshot },
    }),
    authorize: method({
      input: z.object({ id: z.string().min(1).max(80), origin: z.string().url().max(2048) }),
      output: z.object({ authorizationUrl: z.string().url() }),
    }),
    signOut: method({
      input: z.object({ id: z.string().min(1).max(80) }),
      output: snapshotSchema,
      description: 'Remove the stored OAuth grant of one MCP server, so the next connect authorizes again. Call only when the user asked to sign out of it.',
      tool: { name: 'mcp_sign_out_server', render: summarizeSnapshot },
    }),
    setPreferences: method({
      input: z.object({ preferences: preferencesInputSchema }),
      output: snapshotSchema,
      description:
        'Replace the four MCP manager preferences: connect on startup, tool-call timeout in seconds, whether registry search is offered, and the OAuth client name. Call only when the user asked for those preferences.',
      tool: { name: 'mcp_set_preferences', render: summarizeSnapshot },
    }),
    searchRegistry: method({
      input: z.object({ query: z.string().trim().min(1).max(80) }),
      output: z.array(registryEntrySchema).max(20),
      description: 'Search the curated MCP registry for servers matching a term, with each entry transport and documentation link. Read-only.',
      tool: { name: 'mcp_search_registry', readOnly: true, render: summarizeRegistry },
    }),
  },
})
