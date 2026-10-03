import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import WebSocket, { type RawData } from 'ws'

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
)

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

const sessionSummarySchema = z.object({
  agentAvailable: z.boolean(),
  sessionId: z.string(),
  updatedAt: z.number(),
  running: z.boolean(),
  blank: z.boolean(),
  parentSessionId: z.string().optional(),
  origin: z.enum(['subagent']).optional(),
  cwd: z.string().optional(),
  projections: jsonValueSchema.optional(),
})

const pluginSchema = z.object({
  entryId: z.string(),
  moduleName: z.string(),
  meta: jsonValueSchema.optional(),
  enabled: z.boolean(),
  fiberPhase: z.enum(['pending', 'loading', 'active', 'failed', 'unloading']).nullable(),
  readOnlyReason: z.string().optional(),
})

const bundleSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  enabled: z.boolean(),
  installed: z.boolean(),
  optional: z.boolean(),
  removable: z.boolean(),
  readOnlyReason: z.enum(['management-required', 'unaddressable']).optional(),
  error: z.unknown().optional(),
  rows: z.array(z.object({ rowId: z.string(), moduleName: z.string(), entryId: z.string().optional() })),
  overrides: z.array(z.string()),
})

const commandInputSchema = z.object({ hint: z.string(), attachments: z.boolean().optional() })

const commandSchema = z.object({
  definitionId: z.string().optional(),
  name: z.string(),
  description: z.string(),
  input: commandInputSchema.optional(),
})

const settingsNamespaceSchema = z.object({
  ns: z.string(),
  schema: jsonValueSchema,
  value: jsonValueSchema,
  autoGenerate: z.boolean(),
  revision: z.number().safe().nonnegative(),
  applies: z.literal('live'),
  secrets: z.array(z.object({ path: z.array(z.string()), set: z.boolean() })),
})

const settingsDescriptionSchema = z.object({
  writable: z.boolean(),
  hasDocument: z.boolean(),
  namespaces: z.array(settingsNamespaceSchema),
})

const rpcResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string(),
  result: z.union([
    z.object({ ok: z.literal(true), value: z.unknown() }),
    z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.string().optional(),
        message: z.string(),
        details: z.unknown().optional(),
      }),
    }),
  ]),
})

const streamFrameSchema = z.object({
  type: z.enum(['item', 'error', 'end']),
  streamId: z.string(),
  value: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})

const snapshotSchema = z.object({
  type: z.literal('snapshot'),
  cursor: z.number().safe().min(-1),
})

const historyRecordSchema = z
  .object({
    type: z.literal('event'),
    event: z.object({ seq: z.number().safe().nonnegative() }).passthrough(),
  })
  .passthrough()

export interface SessionSummary {
  readonly sessionId: string
  readonly updatedAt: number
  readonly running: boolean
  readonly blank: boolean
  readonly agentAvailable: boolean
  readonly parentSessionId?: string
  readonly origin?: 'subagent'
  readonly cwd?: string
  readonly projections?: JsonValue
}

export interface PluginSummary {
  readonly id: string
  readonly moduleName: string
  readonly meta?: JsonValue
  readonly enabled: boolean
  readonly phase?: string | null
  readonly readOnlyReason?: string
}

export interface BundleSummary {
  readonly name: string
  readonly description?: string
  readonly enabled: boolean
  readonly installed: boolean
  readonly optional: boolean
  readonly removable: boolean
  readonly readOnlyReason?: string
  readonly error?: JsonValue
  readonly rowCount?: number
}

export interface CommandSummary {
  readonly definitionId?: string
  readonly name: string
  readonly description: string
  readonly input?: { readonly hint: string; readonly attachments?: boolean | undefined } | undefined
}

export interface SettingsNamespace {
  readonly ns: string
  readonly schema: JsonValue
  readonly value: JsonValue
  readonly autoGenerate: boolean
  readonly revision: number
  readonly applies: 'live'
  readonly secrets: readonly { readonly path: readonly string[]; readonly set: boolean }[]
}

export interface SettingsDescription {
  readonly writable: boolean
  readonly hasDocument: boolean
  readonly namespaces: readonly SettingsNamespace[]
}

export interface SessionPage {
  readonly records: readonly JsonValue[]
  readonly hasMore: boolean
}

export interface ChangeResult {
  readonly application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  readonly changed: boolean
  readonly enabled?: boolean
  readonly stage: 'install' | 'enable' | 'remove'
  readonly target: string
  readonly error?: { readonly code: string; readonly diagnostic?: string; readonly incompatible?: JsonValue }
  readonly warnings: readonly string[]
}

export interface DshPlatformTransport {
  rpc(namespace: string, method: string, args: readonly JsonValue[], signal?: AbortSignal): Promise<unknown>
  sessionCursor(sessionId: string): Promise<number>
}

export interface DshPlatformClient {
  readonly sessions: {
    list(): Promise<readonly SessionSummary[]>
    create(input: { readonly cwd?: string; readonly agentPreset?: string }): Promise<{ readonly sessionId: string; readonly agentPreset?: string }>
    fork(sessionId: string, atSeq?: number): Promise<{ readonly sessionId: string }>
    cancel(sessionId: string): Promise<{ readonly accepted: true }>
    page(sessionId: string, throughSeq: number, beforeSeq?: number, maxMessages?: number): Promise<SessionPage>
    history(sessionId: string, maxMessages?: number): Promise<SessionPage>
    export(sessionId: string): Promise<readonly JsonValue[]>
  }
  readonly plugins: {
    list(): Promise<readonly PluginSummary[]>
    setEnabled(id: string, enabled: boolean): Promise<ChangeResult>
  }
  readonly bundles: {
    list(): Promise<readonly BundleSummary[]>
    setEnabled(name: string, enabled: boolean): Promise<ChangeResult>
  }
  readonly commands: {
    list(sessionId: string): Promise<readonly CommandSummary[]>
    execute(sessionId: string, line: string, signal?: AbortSignal): Promise<JsonValue | null>
  }
  readonly config: {
    describe(): Promise<SettingsDescription>
    mutate(namespace: string, path: readonly string[], value: JsonValue | undefined, revision: number): Promise<SettingsDescription>
  }
}

export class DshPlatformError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DshPlatformError'
    this.code = code
  }
}

function parseJson(body: string, context: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new DshPlatformError('invalid-response', `${context} returned invalid JSON.`)
  }
}

async function streamMessageText(data: RawData): Promise<string> {
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function decodeJsonValue(value: unknown, context: string): JsonValue {
  const result = jsonValueSchema.safeParse(value)
  if (!result.success) throw new DshPlatformError('invalid-response', `${context} returned data outside the JSON value contract.`)
  return result.data
}

function loopbackLaunchUrl(value: string): { readonly origin: string; readonly token: string } {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new DshPlatformError('invalid-url', 'Set DSHX_URL to the tokenized DSH launch URL printed by dsh.')
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname) || url.username || url.password) {
    throw new DshPlatformError('unsafe-url', 'DSHX currently accepts only an HTTP launch URL on localhost, 127.0.0.1, or ::1.')
  }
  const token = url.searchParams.get('token')
  if (!token || url.pathname !== '/' || url.hash) {
    throw new DshPlatformError('invalid-url', 'The DSH launch URL must include its root-path token query.')
  }
  return { origin: url.origin, token }
}

function mapSession(value: unknown): SessionSummary {
  const parsed = sessionSummarySchema.parse(value)
  return {
    sessionId: parsed.sessionId,
    updatedAt: parsed.updatedAt,
    running: parsed.running,
    blank: parsed.blank,
    agentAvailable: parsed.agentAvailable,
    ...(parsed.parentSessionId === undefined ? {} : { parentSessionId: parsed.parentSessionId }),
    ...(parsed.origin === undefined ? {} : { origin: parsed.origin }),
    ...(parsed.cwd === undefined ? {} : { cwd: parsed.cwd }),
    ...(parsed.projections === undefined ? {} : { projections: parsed.projections }),
  }
}

function mapPlugin(value: unknown): PluginSummary {
  const parsed = pluginSchema.parse(value)
  return {
    id: parsed.entryId,
    moduleName: parsed.moduleName,
    ...(parsed.meta === undefined ? {} : { meta: parsed.meta }),
    enabled: parsed.enabled,
    phase: parsed.fiberPhase,
    ...(parsed.readOnlyReason === undefined ? {} : { readOnlyReason: parsed.readOnlyReason }),
  }
}

function mapBundle(value: unknown): BundleSummary {
  const parsed = bundleSchema.parse(value)
  return {
    name: parsed.name,
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
    enabled: parsed.enabled,
    installed: parsed.installed,
    optional: parsed.optional,
    removable: parsed.removable,
    ...(parsed.readOnlyReason === undefined ? {} : { readOnlyReason: parsed.readOnlyReason }),
    ...(parsed.error === undefined ? {} : { error: decodeJsonValue(parsed.error, 'Bundle inventory') }),
    ...(parsed.rows === undefined ? {} : { rowCount: parsed.rows.length }),
  }
}

function mapSettings(value: unknown): SettingsDescription {
  const parsed = settingsDescriptionSchema.parse(value)
  return {
    writable: parsed.writable,
    hasDocument: parsed.hasDocument,
    namespaces: parsed.namespaces.map(item => ({
      ns: item.ns,
      schema: item.schema,
      value: item.value,
      autoGenerate: item.autoGenerate,
      revision: item.revision,
      applies: item.applies,
      secrets: item.secrets,
    })),
  }
}

function mapChangeResult(value: unknown): ChangeResult {
  const parsed = z
    .object({
      application: z.enum(['applied', 'restart-required', 'overridden', 'failed', 'cancelled']),
      changed: z.boolean(),
      enabled: z.boolean().optional(),
      stage: z.enum(['install', 'enable', 'remove']),
      target: z.string(),
      error: z.object({ code: z.string(), diagnostic: z.string().optional(), incompatible: jsonValueSchema.optional() }).optional(),
      warnings: z.array(z.string()).optional(),
    })
    .parse(value)
  return {
    application: parsed.application,
    changed: parsed.changed,
    ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
    warnings: parsed.warnings ?? [],
    stage: parsed.stage,
    target: parsed.target,
    ...(parsed.error === undefined
      ? {}
      : {
          error: {
            code: parsed.error.code,
            ...(parsed.error.diagnostic === undefined ? {} : { diagnostic: parsed.error.diagnostic }),
            ...(parsed.error.incompatible === undefined ? {} : { incompatible: parsed.error.incompatible }),
          },
        }),
  }
}

function makeTypedClient(transport: DshPlatformTransport): DshPlatformClient {
  const listSessions = async (): Promise<readonly SessionSummary[]> => {
    const result = z.object({ items: z.array(sessionSummarySchema) }).parse(await transport.rpc('session', 'list', [{}]))
    return result.items.map(mapSession)
  }

  const page = async (sessionId: string, throughSeq: number, beforeSeq?: number, maxMessages = 100): Promise<SessionPage> => {
    const result = z.object({ records: z.array(jsonValueSchema), hasMore: z.boolean() }).parse(
      await transport.rpc('session', 'page', [
        {
          address: { kind: 'session', sessionId },
          throughSeq,
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
          maxMessages,
        },
      ]),
    )
    return { records: result.records, hasMore: result.hasMore }
  }

  const describe = async (): Promise<SettingsDescription> => mapSettings(await transport.rpc('settings', 'describe', []))

  return {
    sessions: {
      list: listSessions,
      create: async input => {
        const parsed = z.object({ sessionId: z.string(), agentPreset: z.string().optional() }).parse(await transport.rpc('session', 'create', [input]))
        return parsed.agentPreset === undefined ? { sessionId: parsed.sessionId } : { sessionId: parsed.sessionId, agentPreset: parsed.agentPreset }
      },
      fork: async (sessionId, atSeq) =>
        z.object({ sessionId: z.string() }).parse(await transport.rpc('session', 'fork', [{ sessionId, ...(atSeq === undefined ? {} : { atSeq }) }])),
      cancel: async sessionId => z.object({ accepted: z.literal(true) }).parse(await transport.rpc('session', 'cancel', [{ sessionId }])),
      page,
      history: async (sessionId, maxMessages = 100) => {
        const throughSeq = await transport.sessionCursor(sessionId)
        return page(sessionId, throughSeq, undefined, maxMessages)
      },
      export: async sessionId => {
        const throughSeq = await transport.sessionCursor(sessionId)
        const pages: JsonValue[][] = []
        let beforeSeq: number | undefined
        let hasMore = true
        while (hasMore) {
          const current = await page(sessionId, throughSeq, beforeSeq, 250)
          pages.push([...current.records])
          hasMore = current.hasMore
          if (hasMore) {
            const sequenceValues = current.records
              .map(record => historyRecordSchema.safeParse(record))
              .flatMap(result => (result.success ? [result.data.event.seq] : []))
            const nextBeforeSeq = sequenceValues.reduce<number | undefined>(
              (minimum, value) => (minimum === undefined || value < minimum ? value : minimum),
              undefined,
            )
            if (nextBeforeSeq === undefined || nextBeforeSeq === beforeSeq) {
              throw new DshPlatformError('invalid-history-page', 'DSH reported more session history without an earlier event cursor.')
            }
            beforeSeq = nextBeforeSeq
          }
        }
        return pages.reverse().flatMap(items => items)
      },
    },
    plugins: {
      list: async () => {
        const values = z.array(pluginSchema).parse(await transport.rpc('pluginManager', 'listPlugins', []))
        return values.map(mapPlugin)
      },
      setEnabled: async (id, enabled) => mapChangeResult(await transport.rpc('pluginManager', 'setPluginEnabled', [id, enabled])),
    },
    bundles: {
      list: async () => {
        const values = z.array(bundleSchema).parse(await transport.rpc('pluginManager', 'listBundles', []))
        return values.map(mapBundle)
      },
      setEnabled: async (name, enabled) => mapChangeResult(await transport.rpc('pluginManager', 'setBundleEnabled', [name, enabled])),
    },
    commands: {
      list: async sessionId => {
        const values = z.array(commandSchema).parse(await transport.rpc('commands', 'list', [sessionId]))
        return values.map(item => ({
          ...(item.definitionId === undefined ? {} : { definitionId: item.definitionId }),
          name: item.name,
          description: item.description,
          ...(item.input === undefined ? {} : { input: item.input }),
        }))
      },
      execute: async (sessionId, line, signal) => {
        if (!line.startsWith('/')) throw new DshPlatformError('invalid-command', 'DSH commands must start with / at byte 0.')
        const result = await transport.rpc('commands', 'execute', [sessionId, line, []], signal)
        return result === undefined ? null : decodeJsonValue(result, 'Command execution')
      },
    },
    config: {
      describe,
      mutate: async (namespace, path, value, revision) => {
        const op = value === undefined ? { op: 'unset', path: [...path] } : { op: 'set', path: [...path], value }
        await transport.rpc('settings', 'mutate', [namespace, [op], revision])
        return describe()
      },
    },
  }
}

export function createDshPlatformClientFromTransport(transport: DshPlatformTransport): DshPlatformClient {
  return makeTypedClient(transport)
}

export interface ConnectDshPlatformClientOptions {
  readonly url?: string
  readonly fetch?: typeof fetch
}

export async function connectDshPlatformClient(options: ConnectDshPlatformClientOptions = {}): Promise<DshPlatformClient> {
  const launchUrl = options.url ?? process.env.DSHX_URL
  if (launchUrl === undefined) throw new DshPlatformError('missing-url', 'Set DSHX_URL to the tokenized DSH launch URL printed by dsh.')
  const parsed = loopbackLaunchUrl(launchUrl)
  const request = options.fetch ?? fetch
  let exchange: Response
  try {
    exchange = await request(`${parsed.origin}/?token=${encodeURIComponent(parsed.token)}`, { redirect: 'manual' })
  } catch {
    throw new DshPlatformError('connection-failed', 'Could not reach the local DSH launch URL. Check that dsh is running and the launch URL is current.')
  }
  const cookies = exchange.headers.getSetCookie()
  const cookie = cookies
    .map(item => item.split(';', 1)[0])
    .filter(Boolean)
    .join('; ')
  if (!exchange.ok && exchange.status !== 302 && exchange.status !== 303) {
    if (exchange.status === 401 || exchange.status === 403)
      throw new DshPlatformError('authentication-failed', 'DSH rejected the launch URL. Copy the current tokenized URL printed by dsh.')
    throw new DshPlatformError('authentication-failed', `DSH launch authentication failed with HTTP ${exchange.status}.`)
  }
  if (!cookie) throw new DshPlatformError('authentication-failed', 'DSH did not issue an authenticated session cookie for the launch URL.')

  const rpc = async (namespace: string, method: string, args: readonly JsonValue[], signal?: AbortSignal): Promise<unknown> => {
    const rpcId = randomUUID()
    let response: Response
    try {
      response = await request(`${parsed.origin}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(method)}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId, method: `${namespace}/${method}`, payload: { args } }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      if (signal?.aborted) throw new DshPlatformError('cancelled', 'DSH command request was cancelled by the caller.')
      throw new DshPlatformError('rpc-unreachable', 'The DSH API request failed. Confirm the local Host is running and use its current launch URL.')
    }
    if (response.status === 401) throw new DshPlatformError('authentication-expired', 'The DSH session expired. Copy the current tokenized URL printed by dsh.')
    if (!response.ok) throw new DshPlatformError('rpc-http-error', `DSH API returned HTTP ${response.status} for ${namespace}/${method}.`)
    const envelope = rpcResponseSchema.safeParse(parseJson(await response.text(), `DSH ${namespace}/${method}`))
    if (!envelope.success || envelope.data.rpcId !== rpcId)
      throw new DshPlatformError('invalid-response', `DSH ${namespace}/${method} returned an invalid RPC response.`)
    if (!envelope.data.result.ok) {
      const remoteError = envelope.data.result.error
      throw new DshPlatformError(remoteError.code ?? 'remote-error', remoteError.message)
    }
    return envelope.data.result.value
  }

  const sessionCursor = async (sessionId: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const streamId = randomUUID()
      const url = new URL('/api/remote.mux', parsed.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(url, { headers: { cookie, origin: parsed.origin } })
      const timeout = setTimeout(() => finish(new DshPlatformError('stream-timeout', 'DSH did not open the session history stream in time.')), 10_000)
      let settled = false
      const finish = (error?: DshPlatformError, cursor?: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        socket.removeAllListeners()
        if (socket.readyState === WebSocket.OPEN) {
          if (error === undefined) socket.send(JSON.stringify({ type: 'cancel', streamId }))
          socket.close()
        }
        if (error !== undefined) reject(error)
        else if (cursor !== undefined) resolve(cursor)
        else reject(new DshPlatformError('invalid-response', 'DSH closed the history stream without a snapshot.'))
      }
      socket.once('open', () => {
        socket.send(
          JSON.stringify({
            type: 'open',
            streamId,
            endpoint: 'session/follow',
            payload: { args: [{ address: { kind: 'session', sessionId }, maxMessages: 1 }] },
          }),
        )
      })
      socket.on('message', data => {
        void streamMessageText(data)
          .then(body => {
            let response: unknown
            try {
              response = parseJson(body, 'DSH session stream')
            } catch {
              finish(new DshPlatformError('invalid-response', 'DSH sent invalid JSON on the session history stream.'))
              return
            }
            const frame = streamFrameSchema.safeParse(response)
            if (!frame.success || frame.data.streamId !== streamId) {
              finish(new DshPlatformError('invalid-response', 'DSH sent an invalid session history frame.'))
              return
            }
            if (frame.data.type === 'error') {
              finish(new DshPlatformError(frame.data.error?.code ?? 'stream-error', frame.data.error?.message ?? 'DSH session history stream failed.'))
              return
            }
            if (frame.data.type === 'end') {
              finish(new DshPlatformError('invalid-response', 'DSH closed the history stream before sending its snapshot.'))
              return
            }
            const snapshot = snapshotSchema.safeParse(frame.data.value)
            if (!snapshot.success) {
              finish(new DshPlatformError('invalid-response', 'DSH session history stream did not begin with a snapshot.'))
              return
            }
            finish(undefined, snapshot.data.cursor)
          })
          .catch(() => finish(new DshPlatformError('invalid-response', 'Could not read the DSH session history frame.')))
      })
      socket.once('error', () =>
        finish(new DshPlatformError('stream-unreachable', 'Could not open DSH session history. Confirm that the DSH Host is running.')),
      )
      socket.once('close', () => finish(new DshPlatformError('stream-closed', 'DSH closed the session history stream before it returned a cursor.')))
    })

  return makeTypedClient({ rpc, sessionCursor })
}
