import type { Context } from '@deepseek-ai/cordis'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import type { AnyApiMethodDefinition, ApiCallOptions, ApiClient, ApiClientContract, ApiError } from './types.js'
import { ApiProtocolModel, ContractViolation } from './common.js'
import type { BrowserSpan } from '../tracing/browser.js'
import { BrowserTracingRegistryModel } from '../tracing/browser-registry.js'
import { TraceparentModel } from '../tracing/traceparent.js'

type RpcResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false
      readonly error?: { readonly code?: string; readonly message?: string }
    }

interface ClientConnectionLike {
  readonly rpc?: Pick<ClientConnectionRpc, 'call'>
}

export interface ContextLike {
  get(name: string): unknown
}

interface HostDescriptionSourceLike {
  getSnapshot?: () => unknown
  subscribe?: (listener: () => void) => () => void
}

interface ConnectionLifecycleLike {
  readonly hostDescription?: HostDescriptionSourceLike
}

const clientConnections = new WeakMap<object, ConnectionLifecycleLike | undefined>()

function errorFromRemote(result: Extract<RpcResult, { readonly ok: false }>, apiId: string, method: string): ApiError {
  const code = result.error?.code
  const message = result.error?.message ?? `API method ${method} failed.`
  if (code === 'DSHX6401' || code === 'contract' || code === 'bad-request') {
    return ApiProtocolModel.error('contract', message, apiId, method, false, undefined, code)
  }
  if (code === 'aborted') return ApiProtocolModel.aborted(apiId, method)
  return ApiProtocolModel.error('remote', message, apiId, method, false, undefined, code)
}

/**
 * A Client call made while a browser span or interaction is active becomes its `client` child, and carries that
 * child's `traceparent` so the Host dispatch span joins the trace. Without one, no span: background polling never
 * starts traces of its own.
 */
function browserCallSpan(packageId: string, apiId: string, method: string): BrowserSpan | undefined {
  const tracer = BrowserTracingRegistryModel.current().tracer
  if (tracer?.activeContext() === undefined) return undefined
  return tracer.startSpan(`${apiId}/${method}`, {
    kind: 'client',
    attributes: { 'rpc.system': 'dshx', 'rpc.service': apiId, 'rpc.method': method, 'dshx.plugin.package': packageId },
  })
}

function createApiClient<const Methods extends Record<string, AnyApiMethodDefinition>>(
  context: ContextLike | Context | undefined,
  contract: ApiClientContract<Methods>,
  packageId = 'plugin',
): ApiClient<Methods> {
  const connection = context === undefined || typeof context.get !== 'function' ? undefined : (context.get('connection') as ClientConnectionLike | undefined)
  const channel = ApiProtocolModel.apiChannel(contract.owner ?? packageId, contract.id)
  const call = async (name: string, input: unknown, options?: ApiCallOptions): Promise<unknown> => {
    const rpc = connection?.rpc
    if (rpc?.call === undefined) throw ApiProtocolModel.error('unavailable', 'The DSH Connection provider is unavailable.', contract.id, name, true)
    const span = browserCallSpan(contract.owner ?? packageId, contract.id, name)
    try {
      ApiProtocolModel.throwIfAborted(options?.signal, contract.id, name)
      if (contract.methods[name] === undefined) throw ApiProtocolModel.error('contract', `Unknown API method ${name}.`, contract.id, name, false)
      ApiProtocolModel.jsonBytes(input)
      ApiProtocolModel.throwIfAborted(options?.signal, contract.id, name)
      const request =
        span?.context === undefined
          ? { version: contract.version, input }
          : { version: contract.version, input, [TraceparentModel.envelopeField]: TraceparentModel.format(span.context) }
      const result = await rpc.call('/api', `${channel.slice(1)}/${name}`, request, options?.signal)
      span?.setAttribute('dshx.api.outcome', result.ok ? 'ok' : (result.error?.code ?? 'remote'))
      if (!result.ok) span?.setStatus('error', result.error?.code ?? 'remote')
      ApiProtocolModel.throwIfAborted(options?.signal, contract.id, name)
      if (!result.ok) throw errorFromRemote(result, contract.id, name)
      const envelope = result.value as { version?: unknown; output?: unknown }
      if (envelope.version !== contract.version)
        throw ApiProtocolModel.error('contract', `API version mismatch for ${contract.id}.`, contract.id, name, false, undefined, 'DSHX6401')
      ApiProtocolModel.jsonBytes(envelope.output)
      ApiProtocolModel.throwIfAborted(options?.signal, contract.id, name)
      return envelope.output
    } catch (cause) {
      // A caller that cancels (a query superseded by the next thread) did not see the call fail.
      if (options?.signal?.aborted === true) span?.setAttribute('dshx.api.outcome', 'aborted')
      else span?.recordFailure(cause)
      if (ApiProtocolModel.isApiError(cause)) throw cause
      if (options?.signal?.aborted) throw ApiProtocolModel.aborted(contract.id, name, cause)
      if (cause instanceof ContractViolation) throw ApiProtocolModel.error('contract', cause.message, contract.id, name, false, cause)
      // Connection answers a route nobody registered with HTTP 404: the owning plugin is not loaded.
      if (cause instanceof Error && /\bHTTP 404$/.test(cause.message))
        throw ApiProtocolModel.ownerMissing(contract.owner ?? packageId, contract.id, name, cause)
      throw ApiProtocolModel.error('transport', cause instanceof Error ? cause.message : String(cause), contract.id, name, true, cause)
    } finally {
      span?.end()
    }
  }
  const client: Record<string, unknown> = { safe: {} }
  for (const name of Object.keys(contract.methods)) {
    const invoke = (input?: unknown, options?: ApiCallOptions) => call(name, input, options)
    client[name] = invoke
    ;(client.safe as Record<string, unknown>)[name] = async (input?: unknown, options?: ApiCallOptions) => {
      try {
        return { ok: true, value: await invoke(input, options) }
      } catch (cause) {
        return {
          ok: false,
          error: ApiProtocolModel.isApiError(cause) ? cause : ApiProtocolModel.error('transport', String(cause), contract.id, name, true, cause),
        }
      }
    }
  }
  clientConnections.set(client, connection as ConnectionLifecycleLike | undefined)
  return client as ApiClient<Methods>
}

/**
 * How to reach a dshx API discovered through the registry: the owning package, the API id, its version and the
 * methods this caller needs. `dshxRegistryApi.list()` answers the first three, so a caller never imports the
 * contract it calls.
 */
export interface RegisteredApiSpec {
  readonly owner: string
  readonly id: string
  readonly version: number
  readonly methods: readonly string[]
}

/**
 * Call a registered API by identity instead of by contract. `command-palette` forced this: importing
 * `@dshfiles/memory/api` for its finder would close a Turbo build cycle
 * (command-palette → memory → ai-accounts → secret-catalog → jj-integration → command-palette), so it discovers
 * the API through the registry and decodes the output at its own boundary. Method results are `unknown` on
 * purpose; validate them where they cross into product state.
 */
function createRegisteredApiClient(context: ContextLike | Context | undefined, spec: RegisteredApiSpec): ApiClient<Record<string, AnyApiMethodDefinition>> {
  return createApiClient(context, {
    id: spec.id,
    owner: spec.owner,
    version: spec.version,
    methods: Object.fromEntries(spec.methods.map(name => [name, {} as AnyApiMethodDefinition])),
  })
}

/** Internal lifecycle seam used by the React query adapter. */
function subscribeApiConnection<const Methods extends Record<string, AnyApiMethodDefinition>>(client: ApiClient<Methods>, listener: () => void): () => void {
  const source = clientConnections.get(client)?.hostDescription
  return typeof source?.subscribe === 'function' ? source.subscribe(listener) : () => undefined
}

/** Internal snapshot helper; unavailable while the Host generation is down. */
function apiConnectionAvailable<const Methods extends Record<string, AnyApiMethodDefinition>>(client: ApiClient<Methods>): boolean {
  const source = clientConnections.get(client)?.hostDescription
  return typeof source?.getSnapshot !== 'function' || source.getSnapshot() !== undefined
}

export class ApiRuntimeModel {
  static readonly errorFromRemote = errorFromRemote
  static readonly createClient = createApiClient
  static readonly createRegisteredClient = createRegisteredApiClient
  static readonly subscribeConnection = subscribeApiConnection
  static readonly connectionAvailable = apiConnectionAvailable
}
