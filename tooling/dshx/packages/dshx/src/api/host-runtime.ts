import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { ToolDefinition, ToolRunContext, ToolRuntime } from '@deepseek-ai/dsh-tools'
import type {
  AnyApiMethodDefinition,
  ApiCaller,
  ApiContract,
  ApiHostRegistration,
  ApiSchema,
  RegistryApiView,
  RegistryMethodView,
  RegistryToolSource,
  RegistryToolView,
  RegistryListInput,
  RegistryListing,
  RegistrySkillView,
} from './types.js'
import { ApiDefinitionModel } from './define.js'
import { ApiProtocolModel, ContractViolation } from './common.js'
import { apiKey, apiRegistry, type ApiDispatch, type ApiRegistry, type RegisteredApi, type RegistryMember } from './registry.js'
import { publishedJsonSchema, toToolSchema } from './json-schema.js'
import { TracerModel } from '../tracing/tracer.js'
import { TraceparentModel } from '../tracing/traceparent.js'
import { BrowserTracesIngest } from '../tracing/browser-ingest.js'

// Node resolves the Connection package only where DSH itself has it installed
// (the profile bundle tree), so load it lazily: a Host artifact built without a
// live connection service must never carry a top-level static import of it.
const connectionSchemas = async () => import('@deepseek-ai/dsh-client-connection')

const channelOwners = new WeakMap<object, Map<string, string>>()

const MAX_LOGGED_ERROR = 2000
const SECRET_PATTERNS = [
  /(bearer\s+|authorization[=:]\s*|token[=:]\s*|api[_-]?key[=:]\s*|password[=:]\s*)\S+/gi,
  /\b(sk|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{8,}/g,
]

/** One bounded, best-effort-redacted line for the Host log; never includes the request input. */
function describeFailure(cause: unknown): string {
  const text =
    cause instanceof Error
      ? `${cause.name}: ${cause.message}${cause.stack === undefined ? '' : `\n${cause.stack.split('\n').slice(1, 6).join('\n')}`}`
      : String(cause)
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) =>
      redacted.replace(pattern, (match, prefix: unknown) => `${typeof prefix === 'string' && match.startsWith(prefix) ? prefix : ''}[redacted]`),
    text,
  ).slice(0, MAX_LOGGED_ERROR)
}

interface LoggerLike {
  error(format: string, ...params: unknown[]): void
  warn?(format: string, ...params: unknown[]): void
}

function warn(ctx: Context, message: string): void {
  const logger = hostLogger(ctx)
  if (logger.warn === undefined) console.warn(message)
  else logger.warn(message)
}

function hostLogger(ctx: Context): LoggerLike {
  // SAFETY: Cordis exposes ctx.logger(name) on every Context; a stub Context without it falls back to the console.
  const factory = (ctx as { logger?: unknown }).logger
  if (typeof factory !== 'function') return console
  try {
    const logger: unknown = factory.call(ctx, 'dshx:api')
    return typeof (logger as { error?: unknown } | undefined)?.error === 'function' ? (logger as LoggerLike) : console
  } catch {
    return console
  }
}

interface MountOptions {
  /** False for an API whose own calls must not become spans (the browser-traces forwarder would trace its exports). */
  readonly traced?: boolean
}

function createDispatch(ctx: Context, packageId: string, registration: ApiHostRegistration, options: MountOptions = {}): ApiDispatch {
  const { contract, handlers } = ApiDefinitionModel.hostRegistrationParts(registration)
  const dispatch: ApiDispatch = async (endpoint, payload, signal, caller, peer) => {
    const methodDefinition = contract.methods[endpoint]
    const handler = handlers[endpoint]
    if (methodDefinition === undefined || typeof handler !== 'function') {
      return { ok: false, error: { code: 'bad-request', message: `Unknown API method ${endpoint}.`, details: {} } }
    }
    try {
      ApiProtocolModel.throwIfAborted(signal, contract.id, endpoint)
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
        throw ApiProtocolModel.error('contract', 'Invalid API request envelope.', contract.id, endpoint, false)
      const envelope = payload as { version?: unknown; input?: unknown }
      if (envelope.version !== contract.version)
        throw ApiProtocolModel.error('contract', `API version mismatch for ${contract.id}.`, contract.id, endpoint, false, undefined, 'DSHX6401')
      ApiProtocolModel.jsonBytes(envelope.input)
      const input = await ApiProtocolModel.validate(methodDefinition.input, envelope.input)
      ApiProtocolModel.throwIfAborted(signal, contract.id, endpoint)
      const output = await ApiProtocolModel.validate(methodDefinition.output, await handler({ input, ctx, signal, peer, caller } as never))
      ApiProtocolModel.throwIfAborted(signal, contract.id, endpoint)
      ApiProtocolModel.jsonBytes(output)
      return { ok: true, value: { version: contract.version, output } }
    } catch (cause) {
      if (ApiProtocolModel.isApiError(cause)) return { ok: false, error: { code: cause.remoteCode ?? 'internal', message: cause.message, details: {} } }
      if (cause instanceof ContractViolation) return { ok: false, error: { code: 'contract', message: cause.message, details: {} } }
      if (ApiProtocolModel.isPluginApiError(cause)) return { ok: false, error: { code: cause.code, message: cause.message, details: {} } }
      hostLogger(ctx).error(`API handler ${packageId} ${contract.id}.${endpoint} failed: ${describeFailure(cause)}`)
      return { ok: false, error: { code: 'internal', message: 'API handler failed. See Host diagnostics.', details: {} } }
    }
  }
  return (endpoint, payload, signal, caller, peer) => {
    const tracer = TracerModel.process()
    if (options.traced === false || !tracer.enabled) return dispatch(endpoint, payload, signal, caller, peer)
    const startedAt = performance.now()
    return tracer.withSpan(
      `${contract.id}/${endpoint}`,
      {
        kind: 'server',
        attributes: {
          'rpc.system': 'dshx',
          'rpc.service': contract.id,
          'rpc.method': endpoint,
          'dshx.plugin.package': packageId,
          'dshx.api.id': contract.id,
          'dshx.api.method': endpoint,
          'dshx.api.caller': caller.kind,
          'dshx.api.caller.package': caller.kind === 'plugin' ? caller.packageId : undefined,
          'dsh.session.id': caller.kind === 'agent' ? caller.sessionId : undefined,
        },
      },
      async span => {
        const result = await dispatch(endpoint, payload, signal, caller, peer)
        span.setAttributes({ 'dshx.api.outcome': result.ok ? 'ok' : result.error.code, 'dshx.api.duration_ms': Math.round(performance.now() - startedAt) })
        if (!result.ok) span.setStatus('error', result.error.code)
        return result
      },
    )
  }
}

async function registerRoutes(
  connection: HostConnectionHandle,
  channel: string,
  contract: ApiContract,
  dispatch: ApiDispatch,
): Promise<Array<() => Promise<void>>> {
  const removeRoutes: Array<() => Promise<void>> = []
  try {
    for (const method of Object.keys(contract.methods)) {
      const endpoint = `${channel.slice(1)}/${method}`
      const route: ConnectionFetchRoute = {
        path: `/api/${endpoint}`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async request => {
          if (request.method !== 'POST') return new Response('not found', { status: 404 })
          if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            return new Response('content type must be application/json', { status: 415 })
          }
          let body: unknown
          try {
            body = await request.json()
          } catch {
            return new Response('body is not JSON', { status: 400 })
          }
          const { clientRequestSchema, serverResponseSchema } = await connectionSchemas()
          const parsed = clientRequestSchema.safeParse(body)
          if (!parsed.success) return new Response('invalid Connection RPC request', { status: 400 })
          const message = parsed.data
          if (message.method !== endpoint) {
            const mismatch = serverResponseSchema.parse({
              type: 'server-response',
              rpcId: message.rpcId,
              result: {
                ok: false,
                error: {
                  code: 'gateway/bad-request',
                  message: `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(endpoint)}`,
                  details: {},
                },
              },
            })
            return Response.json(mismatch)
          }
          // A browser caller cannot set headers on a Connection RPC, so its trace context rides in the envelope.
          const parent = TracerModel.parseTraceparent(request.headers.get('traceparent')) ?? TraceparentModel.fromEnvelope(message.payload)
          const result = await TracerModel.process().runWithParent(parent, () =>
            dispatch(method, message.payload, request.signal, { kind: 'client' }, connection.browserPeer),
          )
          return Response.json(serverResponseSchema.parse({ type: 'server-response', rpcId: message.rpcId, result }))
        },
      }
      removeRoutes.push(connection.fetch.register(route))
    }
  } catch (cause) {
    await Promise.all(removeRoutes.map(remove => remove()))
    throw cause
  }
  return removeRoutes
}

type ToolAgent = ToolRunContext['agent']

const toolsOf = (ctx: Context): ToolRuntime | undefined => {
  try {
    return ctx.get('tools')
  } catch {
    return undefined
  }
}

const agentCaller = (agent: ToolAgent): ApiCaller => {
  if (agent === undefined) return { kind: 'agent' }
  const cwd = agent.session.header.cwd
  return cwd === undefined || cwd === '' ? { kind: 'agent', sessionId: agent.id } : { kind: 'agent', sessionId: agent.id, cwd }
}

/** A `z.void()`-style input has no JSON Schema; it is a no-argument tool when it accepts `undefined` synchronously. */
const acceptsNoInput = (schema: ApiSchema): boolean => {
  const result = schema['~standard'].validate(undefined)
  return !(result instanceof Promise) && result.issues === undefined
}

/** Build the native tool for one exposed method; the call runs through the same dispatch as every other caller. */
function apiTool(contract: ApiContract, method: string, definition: AnyApiMethodDefinition, dispatch: ApiDispatch): ToolDefinition {
  const exposure = definition.tool
  if (exposure === undefined) throw new Error(`API ${contract.id}.${method} is not exposed as a tool.`)
  const inputSchema = publishedJsonSchema(definition.input, 'input')
  if (definition.input !== undefined && inputSchema === undefined && !acceptsNoInput(definition.input)) {
    throw new Error(
      `API ${contract.id}.${method} cannot become tool ${exposure.name}: its input schema publishes no Standard JSON Schema (use zod 4.2+ or remove tool).`,
    )
  }
  const parameters = toToolSchema(inputSchema)
  const takesInput = parameters.type === 'object'
  const description = exposure.description ?? definition.description
  if (description === undefined) throw new Error(`API ${contract.id}.${method} needs a description before it can become tool ${exposure.name}.`)
  const tool: ToolDefinition = {
    name: exposure.name,
    description,
    parameters: takesInput ? { ...parameters } : { type: 'object', properties: {} },
    output: {
      schema: { description: `${contract.id}.${method} output` },
      render: (_args, value) => [{ type: 'text', text: exposure.render === undefined ? JSON.stringify(value, null, 2) : exposure.render(value) }],
    },
    execute: async (args, execution) => {
      const result = await dispatch(
        method,
        { version: contract.version, input: takesInput ? args : undefined },
        execution.signal,
        agentCaller(execution.agent),
        undefined,
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.value.output ?? null
    },
  }
  if (exposure.readOnly === true) tool.isConcurrencySafe = () => true
  return tool
}

function describeMethod(name: string, definition: AnyApiMethodDefinition, schemas: boolean): RegistryMethodView {
  const view = { name }
  if (definition.description !== undefined) Object.assign(view, { description: definition.description })
  if (definition.tool !== undefined) Object.assign(view, { tool: definition.tool.name })
  if (!schemas) return view
  const input = publishedJsonSchema(definition.input, 'input')
  if (input !== undefined) Object.assign(view, { input })
  const output = publishedJsonSchema(definition.output, 'output')
  if (output !== undefined) Object.assign(view, { output })
  return view
}

export function describeApis(registry: ApiRegistry, input: RegistryListInput): RegistryApiView[] {
  return [...registry.apis.values()]
    .filter(api => input.owner === undefined || api.owner === input.owner)
    .sort((left, right) => left.owner.localeCompare(right.owner) || left.id.localeCompare(right.id))
    .map(api => ({
      owner: api.owner,
      id: api.id,
      version: api.version,
      methods: Object.entries(api.methods).map(([name, definition]) => describeMethod(name, definition, input.schemas === true)),
    }))
}

/** The slice of DSH's agent registry the listing reads; dshx does not depend on its package. */
interface AgentsLike {
  get(id: string): NonNullable<ToolAgent> | undefined
  list(): readonly NonNullable<ToolAgent>[]
}

/** The slice of DSH's skill registry the listing reads. */
interface SkillsLike {
  list(options: { readonly cwd?: string; readonly scope?: object }): Promise<
    ReadonlyArray<
      Pick<RegistrySkillView, 'name' | 'description' | 'provider' | 'source'> & {
        readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
      }
    >
  >
}

/**
 * Agent presets register most model-facing tools in an agent's own scope, so
 * the global view misses them. Read the tools one live agent sees: the
 * requested Session's, else the first live one.
 */
function viewingAgent(ctx: Context, sessionId: string | undefined): NonNullable<ToolAgent> | undefined {
  try {
    const agents: AgentsLike | undefined = ctx.get('agents')
    return sessionId === undefined ? agents?.list()[0] : agents?.get(sessionId)
  } catch {
    return undefined
  }
}

async function listSkills(ctx: Context, options: { readonly cwd?: string; readonly scope?: object }): Promise<RegistryListing['skills']> {
  try {
    const skills: SkillsLike | undefined = ctx.get('skills')
    if (skills === undefined) return []
    return (await skills.list(options)).map(skill => ({
      name: skill.name,
      description: skill.description,
      provider: skill.provider,
      ...(skill.source !== undefined && { source: skill.source }),
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
    }))
  } catch (cause) {
    warn(ctx, `dshx registry: skill listing failed: ${describeFailure(cause)}`)
    return []
  }
}

const toolSource = (name: string, apiOwner: string | undefined, pluginOwner: string | undefined): RegistryToolSource => {
  if (apiOwner !== undefined) return 'api'
  if (name.startsWith('mcp__')) return 'mcp'
  return pluginOwner === undefined ? 'tool' : 'plugin'
}

async function describeRegistry(ctx: Context, registry: ApiRegistry, input: RegistryListInput): Promise<RegistryListing> {
  const apiTools = new Map<string, string>()
  for (const api of registry.apis.values()) {
    for (const definition of Object.values(api.methods)) if (definition.tool !== undefined) apiTools.set(definition.tool.name, api.owner)
  }
  const agent = viewingAgent(ctx, input.sessionId)
  const runtime = toolsOf(ctx)
  const visible = runtime?.schemas(agent) ?? []
  const visibleNames = new Set(visible.map(schema => schema.name))
  const restricted = agent === undefined ? [] : (runtime?.schemas() ?? []).filter(schema => !visibleNames.has(schema.name))
  const describeTool = (schema: { readonly name: string; readonly description: string }, enabled: boolean): RegistryToolView => {
    const apiOwner = apiTools.get(schema.name)
    const definition = runtime?.get(schema.name, enabled ? agent : undefined)
    const pluginOwner = definition === undefined ? undefined : registry.toolOwners?.get(definition)
    const owner = apiOwner ?? pluginOwner
    const readOnly = definition?.isConcurrencySafe !== undefined
    const view = { name: schema.name, description: schema.description, source: toolSource(schema.name, apiOwner, pluginOwner), readOnly, enabled }
    if (owner !== undefined) Object.assign(view, { owner })
    return view
  }
  const tools = [...visible.map(schema => describeTool(schema, true)), ...restricted.map(schema => describeTool(schema, false))].sort((left, right) =>
    left.name.localeCompare(right.name),
  )
  const skillOptions = {}
  const cwd = input.cwd ?? (agent?.session.header.cwd || undefined)
  if (cwd !== undefined) Object.assign(skillOptions, { cwd })
  if (agent !== undefined) Object.assign(skillOptions, { scope: agent })
  const listing = {
    apis: describeApis(registry, input),
    tools,
    skills: await listSkills(ctx, skillOptions),
  }
  if (agent !== undefined) Object.assign(listing, { toolScope: { sessionId: agent.id } })
  // Published JSON Schemas may carry accessors; the transport accepts plain data only.
  return structuredClone(listing)
}

const capabilitiesTool = (registry: ApiRegistry): ToolDefinition => ({
  name: 'dshx_capabilities',
  description:
    'List the typed APIs DSH plugins serve in this process: owner package, methods, what each does, and which are callable by you as tools. Use it to find a plugin capability before asking the user for data a plugin already has. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      owner: { type: 'string', description: 'Only this package, e.g. "@dshfiles/jj-integration".' },
      schemas: { type: 'boolean', description: 'Include each method’s JSON Schema.' },
    },
  },
  output: {
    schema: { description: 'API listing' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  isConcurrencySafe: () => true,
  execute: async args => {
    const filter = {}
    if (args instanceof Object && 'owner' in args) {
      const owner = [...registry.apis.values()].find(api => api.owner === args.owner)?.owner
      // An unknown owner lists nothing rather than everything.
      Object.assign(filter, { owner: owner ?? '' })
    }
    if (args instanceof Object && 'schemas' in args && args.schemas === true) Object.assign(filter, { schemas: true })
    return structuredClone({ apis: describeApis(registry, filter) })
  },
})

/** The browser-traces forwarder rides with the registry: one per process, served by whichever dshx Host leads it. */
async function mountBrowserTraces(ctx: Context): Promise<() => Promise<void>> {
  const forwarder = BrowserTracesIngest.createForwarder()
  try {
    const mounted = await mountApi(ctx, ApiDefinitionModel.registryOwner, forwarder.registration, { traced: false })
    return async () => {
      await mounted.dispose()
      await forwarder.flush()
    }
  } catch (cause) {
    warn(ctx, `dshx registry: browser traces are not forwarded: ${describeFailure(cause)}`)
    return async () => undefined
  }
}

async function lead(registry: ApiRegistry): Promise<void> {
  const member = registry.members[0]
  if (member === undefined || registry.leader !== undefined) return
  registry.leader = member
  const registration = ApiDefinitionModel.registryApi.host({ list: ({ input }) => describeRegistry(member.ctx, registry, input ?? {}) })
  try {
    const unmount = (await mountApi(member.ctx, ApiDefinitionModel.registryOwner, registration)).dispose
    const unmountBrowserTraces = await mountBrowserTraces(member.ctx)
    const tools = toolsOf(member.ctx)
    const unregister = tools?.register(capabilitiesTool(registry))
    member.stop = async () => {
      try {
        unregister?.()
      } catch {
        // The tools layer may already have released it with the Host fiber.
      }
      await unmountBrowserTraces()
      await unmount()
    }
  } catch (cause) {
    warn(member.ctx, `dshx registry: ${member.packageId} could not serve the registry: ${describeFailure(cause)}`)
  }
}

function joinRegistry(ctx: Context, packageId: string, registry: ApiRegistry): void {
  if (registry.members.some(member => member.ctx === ctx)) return
  const member: RegistryMember = { ctx, packageId }
  registry.members.push(member)
  void lead(registry)
  ctx.effect(
    () => async () => {
      const index = registry.members.indexOf(member)
      if (index >= 0) registry.members.splice(index, 1)
      if (registry.leader !== member) return
      await member.stop?.()
      registry.leader = undefined
      await lead(registry)
    },
    'dshx api registry membership',
  )
}

/** Serve one API: Connection routes for Clients, the in-process registry for Host plugins, and opted-in agent tools. Returns its disposer. */
async function mountApi(
  ctx: Context,
  packageId: string,
  registration: ApiHostRegistration,
  options: MountOptions = {},
): Promise<{ readonly dispose: () => Promise<void>; readonly servesClients: boolean }> {
  const { contract } = ApiDefinitionModel.hostRegistrationParts(registration)
  if (contract.owner !== undefined && contract.owner !== packageId) {
    throw new Error(`API ${contract.id} is owned by ${contract.owner} and cannot be served by ${packageId}.`)
  }
  const registry = apiRegistry(ctx)
  const key = apiKey(packageId, contract.id)
  if (registry.apis.has(key)) throw new Error(`API ${contract.id} of ${packageId} is already served in this process.`)
  const channel = ApiProtocolModel.apiChannel(packageId, contract.id)
  const root = ctx.root ?? ctx
  const owners = channelOwners.get(root) ?? new Map<string, string>()
  const owner = `${packageId}:${contract.id}`
  const previous = owners.get(channel)
  if (previous !== undefined) {
    throw new Error(`API channel collision at ${channel}: ${previous} and ${owner}.`)
  }
  const dispatch = createDispatch(ctx, packageId, registration, options)
  const connection = ctx.get('connection') as HostConnectionHandle | undefined
  const servesClients = connection?.fetch?.register !== undefined
  const removeRoutes = connection?.fetch?.register === undefined ? [] : await registerRoutes(connection, channel, contract, dispatch)
  if (!servesClients) {
    warn(ctx, `API ${contract.id} serves Host plugins only: the DSH Connection provider is not loaded.`)
  }
  const served: RegisteredApi = { owner: packageId, id: contract.id, version: contract.version, methods: contract.methods, dispatch }
  owners.set(channel, owner)
  channelOwners.set(root, owners)
  registry.apis.set(key, served)
  const unregisterTools: Array<() => void> = []
  const exposed = Object.entries(contract.methods).filter(([, definition]) => definition.tool !== undefined)
  if (exposed.length > 0) {
    const tools = toolsOf(ctx)
    if (tools === undefined) warn(ctx, `API ${contract.id} cannot expose agent tools: the tools service is not loaded.`)
    for (const [method, definition] of tools === undefined ? [] : exposed) {
      try {
        unregisterTools.push(tools!.register(apiTool(contract, method, definition, dispatch)))
      } catch (cause) {
        warn(ctx, `API ${contract.id}.${method} is not exposed to the agent: ${describeFailure(cause)}`)
      }
    }
  }
  const dispose = async (): Promise<void> => {
    if (registry.apis.get(key) === served) registry.apis.delete(key)
    if (owners.get(channel) === owner) owners.delete(channel)
    if (owners.size === 0) channelOwners.delete(root)
    for (const unregister of unregisterTools) {
      try {
        unregister()
      } catch {
        // Released with the Host fiber already.
      }
    }
    await Promise.all(removeRoutes.map(remove => remove()))
    await TracerModel.process().flush()
  }
  return { dispose, servesClients }
}

export async function registerApi(ctx: Context, packageId: string, registration: ApiHostRegistration): Promise<void> {
  const mounted = await mountApi(ctx, packageId, registration)
  try {
    ctx.effect(() => mounted.dispose, `dshx api: ${ApiDefinitionModel.hostRegistrationParts(registration).contract.id}`)
  } catch (cause) {
    await mounted.dispose()
    throw cause
  }
  if (mounted.servesClients) joinRegistry(ctx, packageId, apiRegistry(ctx))
}
