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

export const mcpServersApi = defineApi({
  id: 'mcp-servers',
  owner: '@dshfiles/mcp-servers',
  version: 1,
  methods: {
    list: method({ input: z.void(), output: snapshotSchema }),
    refresh: method({ input: z.void(), output: snapshotSchema }),
    save: method({ input: z.object({ server: serverDraftSchema }), output: snapshotSchema }),
    setEnabled: method({ input: z.object({ id: z.string().min(1).max(80), enabled: z.boolean() }), output: snapshotSchema }),
    setConnection: method({ input: z.object({ id: z.string().min(1).max(80), connected: z.boolean() }), output: snapshotSchema }),
    remove: method({ input: z.object({ id: z.string().min(1).max(80) }), output: snapshotSchema }),
    authorize: method({
      input: z.object({ id: z.string().min(1).max(80), origin: z.string().url().max(2048) }),
      output: z.object({ authorizationUrl: z.string().url() }),
    }),
    signOut: method({ input: z.object({ id: z.string().min(1).max(80) }), output: snapshotSchema }),
    setPreferences: method({ input: z.object({ preferences: preferencesInputSchema }), output: snapshotSchema }),
    searchRegistry: method({ input: z.object({ query: z.string().trim().min(1).max(80) }), output: z.array(registryEntrySchema).max(20) }),
  },
})
