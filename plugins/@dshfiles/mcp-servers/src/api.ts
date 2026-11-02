import { defineApi } from '@dshfiles/dshx/api'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { McpCatalogModel } from './catalog.js'
import { McpContract, McpSchema } from './schema.js'

const namePattern = /^[A-Za-z_][A-Za-z0-9_]*$/
const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export const referenceNameSchema = Schema.String.check(Schema.isPattern(namePattern), Schema.isMaxLength(128))
const envNameSchema = Schema.String.check(Schema.isPattern(namePattern), Schema.isMaxLength(128))
const headerNameSchema = Schema.String.check(Schema.isPattern(headerNamePattern), Schema.isMaxLength(128))

const atMost32References = Schema.makeFilter((record: { readonly [key: string]: string }) =>
  Object.keys(record).length <= 32 ? undefined : 'At most 32 credential reference entries are allowed.',
)
const envRefsSchema = Schema.Record(envNameSchema, referenceNameSchema).check(atMost32References)
const headerRefsSchema = Schema.Record(headerNameSchema, referenceNameSchema).check(atMost32References)

const isAbsolutePath = (value: string): boolean => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)
const absolutePathSchema = McpSchema.trimmedString.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2048),
  Schema.makeFilter((value: string) => (isAbsolutePath(value) ? undefined : 'Use an absolute working directory for the local start command.')),
)

const endpointWith = (allowLoopbackHttp: boolean) =>
  Schema.String.check(
    Schema.isMaxLength(2048),
    Schema.makeFilter((value: string) => {
      if (!URL.canParse(value)) return 'Use an HTTPS endpoint without embedded credentials.'
      const url = new URL(value)
      const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
      const secure = url.protocol === 'https:' || (allowLoopbackHttp && url.protocol === 'http:' && loopback)
      return secure && url.username === '' && url.password === '' && url.search === '' && url.hash === ''
        ? undefined
        : 'Use an HTTPS endpoint without embedded credentials.'
    }),
  )

/** A catalog or Registry entry: always HTTPS. */
const endpointSchema = endpointWith(false)
/** A server the user registers may also be plain HTTP on this machine: a local MCP server or the helper an entry starts. */
const serverEndpointSchema = endpointWith(true)

const authSchema = Schema.Literals(['none', 'oauth'])

const baseDraft = {
  id: Schema.String.check(Schema.isMaxLength(80)),
  name: McpSchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  serverName: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,32}$/)),
  enabled: Schema.Boolean,
}

const commandSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))
const commandArgsSchema = McpSchema.list(Schema.String.check(Schema.isMaxLength(4096)), 128)
const commandLineSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8192))
const cwdSchema = Schema.String.check(Schema.isMaxLength(2048))

const localStartSchema = Schema.Struct({
  command: commandSchema,
  args: commandArgsSchema,
  cwd: absolutePathSchema,
  envRefs: envRefsSchema,
})
const localStartDraftSchema = Schema.Struct({
  commandLine: commandLineSchema,
  cwd: absolutePathSchema,
  envRefs: envRefsSchema,
})

export const storedServerSchema = Schema.Union([
  Schema.Struct({
    ...baseDraft,
    transport: Schema.Literal('stdio'),
    command: commandSchema,
    args: commandArgsSchema,
    cwd: cwdSchema,
    envRefs: envRefsSchema,
  }),
  Schema.Struct({
    ...baseDraft,
    transport: Schema.Literal('streamable-http'),
    url: serverEndpointSchema,
    headerRefs: headerRefsSchema,
    auth: Schema.optional(authSchema),
    startCommand: Schema.optional(localStartSchema),
  }),
])

export const stdioDraftSchema = Schema.Struct({
  ...baseDraft,
  transport: Schema.Literal('stdio'),
  commandLine: commandLineSchema,
  cwd: cwdSchema,
  envRefs: envRefsSchema,
})

export const httpDraftSchema = Schema.Struct({
  ...baseDraft,
  transport: Schema.Literal('streamable-http'),
  url: serverEndpointSchema,
  headerRefs: headerRefsSchema,
  auth: Schema.optional(authSchema),
  startCommand: Schema.optional(Schema.NullOr(localStartDraftSchema)),
})

export const serverDraftSchema = Schema.Union([stdioDraftSchema, httpDraftSchema])

const oauthStateSchema = Schema.Literals(['not-used', 'signed-in', 'needs-sign-in'])
const credentialReferenceSchema = Schema.Struct({ target: Schema.String, reference: Schema.String, configured: Schema.Boolean })
const configurationSchema = Schema.Literals(['ready', 'needs-credentials'])
const clientLifecycleSchema = Schema.Literals(['inactive', 'starting', 'loaded', 'start-failed', 'manually-disconnected'])
const localProcessSchema = Schema.Literals(['not-configured', 'starting', 'running', 'exited', 'stopping', 'stopped', 'stop-unconfirmed'])
const registeredToolCountSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const defaultOauth = oauthStateSchema.pipe(Schema.withDecodingDefaultKey(Effect.succeed('not-used')))

export const serverViewSchema = Schema.Union([
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    serverName: Schema.String,
    enabled: Schema.Boolean,
    transport: Schema.Literal('stdio'),
    commandLine: Schema.String,
    cwd: Schema.String,
    credentialReferences: Schema.Array(credentialReferenceSchema),
    configuration: configurationSchema,
    clientLifecycle: clientLifecycleSchema,
    localProcess: localProcessSchema,
    connectionHealth: Schema.Literal('not-reported'),
    registeredToolCount: registeredToolCountSchema,
    oauth: defaultOauth,
  }),
  Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    serverName: Schema.String,
    enabled: Schema.Boolean,
    transport: Schema.Literal('streamable-http'),
    url: Schema.String,
    credentialReferences: Schema.Array(credentialReferenceSchema),
    configuration: configurationSchema,
    clientLifecycle: clientLifecycleSchema,
    localProcess: localProcessSchema,
    startCommand: Schema.optional(Schema.Struct({ commandLine: Schema.String, cwd: Schema.String })),
    connectionHealth: Schema.Literal('not-reported'),
    registeredToolCount: registeredToolCountSchema,
    oauth: defaultOauth,
  }),
])

export const providerSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: Schema.String,
  description: Schema.String,
  url: endpointSchema,
  auth: Schema.Literals(['oauth', 'none', 'token']),
  docsUrl: McpSchema.absoluteUrl('Use an absolute documentation URL.'),
})

export const registryEntrySchema = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  category: Schema.String,
  description: Schema.String,
  version: Schema.String,
  endpoint: Schema.NullOr(endpointSchema),
  docsUrl: Schema.NullOr(McpSchema.absoluteUrl('Use an absolute documentation URL.')),
})

/** A stored field that resets to its default instead of failing the row it belongs to. */
const resettable = <S extends Schema.Top>(schema: S, value: S['Type'] & S['Encoded']) =>
  schema.pipe(
    Schema.catchDecoding(() => Effect.succeed(Option.some(value))),
    Schema.withDecodingDefaultKey(Effect.succeed(value)),
  )

/** The four manager preferences, stored beside the server list in the Loader row; each field falls back on its own. */
export const preferencesSchema = Schema.Struct({
  connectOnStartup: resettable(Schema.Boolean, true),
  toolCallTimeoutSeconds: resettable(McpSchema.intBetween(5, 600), 30),
  registrySearch: resettable(Schema.Boolean, true),
  oauthClientName: resettable(McpSchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(120)), 'DSH MCP servers'),
})

/** What a save must satisfy: unlike stored values, an invalid field is refused instead of reset. */
export const preferencesInputSchema = Schema.Struct({
  connectOnStartup: Schema.Boolean,
  toolCallTimeoutSeconds: McpSchema.intBetween(5, 600),
  registrySearch: Schema.Boolean,
  oauthClientName: McpSchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
})

export const snapshotSchema = Schema.Struct({
  servers: Schema.Array(serverViewSchema),
  providers: Schema.Array(providerSchema),
  connectionHealth: Schema.Literal('not-reported'),
  registrySearch: Schema.Boolean,
  preferences: preferencesInputSchema,
})

const defaultPreferences = McpSchema.decode(preferencesSchema, {})

/**
 * Client boundary decode. A Host that predates a field (the live DSH keeps the
 * old Host until restart) still yields a complete snapshot: missing fields take
 * defaults, and a provider list without endpoints falls back to the bundled catalog.
 */
const compatibleSnapshotSchema = Schema.Struct({
  servers: resettable(Schema.Array(serverViewSchema), []),
  providers: resettable(Schema.Array(providerSchema), [...McpCatalogModel.providers]),
  connectionHealth: resettable(Schema.Literal('not-reported'), 'not-reported'),
  registrySearch: resettable(Schema.Boolean, true),
  preferences: resettable(preferencesInputSchema, defaultPreferences),
})

export const decodeSnapshot = (raw: unknown): ManagerSnapshot => McpSchema.decode(compatibleSnapshotSchema, raw ?? {})

export type StoredServer = typeof storedServerSchema.Type
export type ServerDraft = typeof serverDraftSchema.Type
export type ServerView = typeof serverViewSchema.Type
export type RegistryEntry = typeof registryEntrySchema.Type
export type ManagerSnapshot = typeof snapshotSchema.Type
export type ManagerPreferences = typeof preferencesInputSchema.Type

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
    list: McpContract.method({
      input: Schema.Void,
      output: snapshotSchema,
      description:
        'Every MCP server configured in this profile with its transport, whether it is enabled, its client lifecycle and how many tools it registered. Read-only.',
      tool: { name: 'mcp_list_servers', readOnly: true, render: summarizeSnapshot },
    }),
    refresh: McpContract.method({
      input: Schema.Void,
      output: snapshotSchema,
      description:
        'Reconcile the native MCP clients with the stored server list and report the result, for example after the profile changed outside this DSH. Call only when the user asked to refresh the servers.',
      tool: { name: 'mcp_refresh_servers', render: summarizeSnapshot },
    }),
    save: McpContract.method({
      input: Schema.Struct({ server: serverDraftSchema }),
      output: snapshotSchema,
      description:
        'Add or edit one MCP server in the profile: stdio with a command line, environment references and a working directory, or streamable HTTP with a URL, header references, optional auth and a local start command. Call only when the user asked for that change.',
      tool: { name: 'mcp_save_server', render: summarizeSnapshot },
    }),
    setEnabled: McpContract.method({
      input: Schema.Struct({ id: McpSchema.id(80), enabled: Schema.Boolean }),
      output: snapshotSchema,
      description: 'Enable or disable one MCP server in the profile without removing it. Call only when the user asked to enable or disable that server.',
      tool: { name: 'mcp_set_server_enabled', render: summarizeSnapshot },
    }),
    setConnection: McpContract.method({
      input: Schema.Struct({ id: McpSchema.id(80), connected: Schema.Boolean }),
      output: snapshotSchema,
      description:
        'Connect or disconnect one MCP server native client in this Host process without changing its saved enabled state. Call only when the user asked to connect or disconnect it.',
      tool: { name: 'mcp_set_connection', render: summarizeSnapshot },
    }),
    remove: McpContract.method({
      input: Schema.Struct({ id: McpSchema.id(80) }),
      output: snapshotSchema,
      description: 'Remove one MCP server from the profile, including its stored OAuth grant. Call only when the user asked to remove that server.',
      tool: { name: 'mcp_remove_server', render: summarizeSnapshot },
    }),
    authorize: McpContract.method({
      input: Schema.Struct({ id: McpSchema.id(80), origin: McpSchema.absoluteUrl('Use an absolute origin URL.').check(Schema.isMaxLength(2048)) }),
      output: Schema.Struct({ authorizationUrl: McpSchema.absoluteUrl('Use an absolute authorization URL.') }),
    }),
    signOut: McpContract.method({
      input: Schema.Struct({ id: McpSchema.id(80) }),
      output: snapshotSchema,
      description: 'Remove the stored OAuth grant of one MCP server, so the next connect authorizes again. Call only when the user asked to sign out of it.',
      tool: { name: 'mcp_sign_out_server', render: summarizeSnapshot },
    }),
    setPreferences: McpContract.method({
      input: Schema.Struct({ preferences: preferencesInputSchema }),
      output: snapshotSchema,
      description:
        'Replace the four MCP manager preferences: connect on startup, tool-call timeout in seconds, whether registry search is offered, and the OAuth client name. Call only when the user asked for those preferences.',
      tool: { name: 'mcp_set_preferences', render: summarizeSnapshot },
    }),
    searchRegistry: McpContract.method({
      input: Schema.Struct({ query: McpSchema.trimmedString.check(Schema.isMinLength(1), Schema.isMaxLength(80)) }),
      output: McpSchema.list(registryEntrySchema, 20),
      description: 'Search the curated MCP registry for servers matching a term, with each entry transport and documentation link. Read-only.',
      tool: { name: 'mcp_search_registry', readOnly: true, render: summarizeRegistry },
    }),
  },
})
