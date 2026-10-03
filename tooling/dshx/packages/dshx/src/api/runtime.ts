import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { AnyApiMethodDefinition, ApiCallOptions, ApiClient, ApiContract, ApiError, ApiErrorKind, ApiHostRegistration } from './types.js'
import { apiHostRegistrationParts } from './define.js'

const MAX_JSON_BYTES = 1024 * 1024
const channelOwners = new WeakMap<object, Map<string, string>>()

class ContractViolation extends Error {
  override readonly name = 'ContractViolation'
}

const API_ERROR = Symbol('dshx.api-error')

class InternalApiError extends Error {
  override readonly name = 'ApiError' as const
  readonly [API_ERROR] = true

  constructor(
    readonly kind: ApiErrorKind,
    message: string,
    readonly apiId: string,
    readonly method: string,
    readonly retryable: boolean,
    readonly remoteCode?: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof InternalApiError || (typeof value === 'object' && value !== null && (value as Record<PropertyKey, unknown>)[API_ERROR] === true)
}

type RpcResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false
      readonly error?: { readonly code?: string; readonly message?: string }
    }

interface ConnectionLike {
  readonly rpc?: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult>
    handle?(channel: string, handler: ConnectionRpcHandler): () => Promise<void>
  }
}

interface ContextLike {
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

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function apiChannel(packageId: string, apiId: string): string {
  return `/dshx-${stableHash(`${packageId}\0${apiId}`)}`
}

function jsonBytes(value: unknown): number {
  if (value === undefined) return 0
  const active = new Set<object>()
  const visit = (item: unknown, depth: number): void => {
    if (depth > 100) throw new ContractViolation('API payload exceeds 100 levels of JSON nesting.')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (typeof item !== 'object' || item === null)
      throw new ContractViolation('API payload must contain only JSON values; undefined is permitted only for a void root.')
    if (active.has(item)) throw new ContractViolation('API payload contains a cycle.')
    const prototype = Object.getPrototypeOf(item)
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null)
      throw new ContractViolation('API payload must use plain objects and arrays.')
    if (Object.getOwnPropertySymbols(item).length > 0) throw new ContractViolation('API payload cannot contain symbol properties.')
    active.add(item)
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) visit(item[index], depth + 1)
    } else {
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(item))) {
        if (descriptor.get !== undefined || descriptor.set !== undefined || !descriptor.enumerable)
          throw new ContractViolation('API payload cannot contain accessors or non-enumerable properties.')
        visit(descriptor.value, depth + 1)
      }
    }
    active.delete(item)
  }
  visit(value, 0)
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch (cause) {
    throw new ContractViolation(`API payload is not JSON serializable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (encoded === undefined) throw new ContractViolation('API payload must be JSON serializable.')
  const bytes = new TextEncoder().encode(encoded).byteLength
  if (bytes > MAX_JSON_BYTES) throw new ContractViolation(`API payload exceeds ${MAX_JSON_BYTES} bytes.`)
  return bytes
}

async function validate(schema: unknown, value: unknown): Promise<unknown> {
  if (schema === undefined) return value
  const validator = (
    schema as {
      '~standard'?: {
        validate?: (input: unknown) => unknown | Promise<unknown>
      }
    }
  )['~standard']?.validate
  if (typeof validator !== 'function') throw new ContractViolation('API schema does not implement Standard Schema validate().')
  const result = await validator(value)
  if (result === undefined || typeof result !== 'object' || result === null) {
    throw new ContractViolation('API schema returned an invalid Standard Schema result.')
  }
  if ((result as { readonly issues?: unknown }).issues !== undefined) {
    throw new ContractViolation('API schema validation failed.')
  }
  if (!Object.hasOwn(result, 'value')) throw new ContractViolation('API schema success result is missing value.')
  return (result as { readonly value: unknown }).value
}

function error(kind: ApiError['kind'], message: string, apiId: string, method: string, retryable: boolean, cause?: unknown, remoteCode?: string): ApiError {
  return new InternalApiError(kind, message, apiId, method, retryable, remoteCode, cause === undefined ? undefined : { cause }) as unknown as ApiError
}

function aborted(apiId: string, method: string, cause?: unknown): ApiError {
  return error('aborted', 'API request was aborted.', apiId, method, false, cause, 'aborted')
}

function throwIfAborted(signal: AbortSignal | undefined, apiId: string, method: string): void {
  if (signal?.aborted === true) throw aborted(apiId, method, signal.reason)
}

function errorFromRemote(result: Extract<RpcResult, { readonly ok: false }>, apiId: string, method: string): ApiError {
  const code = result.error?.code
  const message = result.error?.message ?? `API method ${method} failed.`
  if (code === 'DSHX6401' || code === 'contract' || code === 'bad-request') {
    return error('contract', message, apiId, method, false, undefined, code)
  }
  if (code === 'aborted') return aborted(apiId, method)
  return error('remote', message, apiId, method, false, undefined, code)
}

export async function registerApi(ctx: Context, packageId: string, registration: ApiHostRegistration): Promise<void> {
  const registrationParts = apiHostRegistrationParts(registration)
  const contract = registrationParts.contract
  const connection = ctx.get('connection') as ConnectionLike | undefined
  if (connection?.rpc?.handle === undefined) {
    console.warn(`API ${contract.id} is unavailable because the DSH Connection provider is not loaded.`)
    return
  }
  const channel = apiChannel(packageId, contract.id)
  const root = ctx.root ?? ctx
  const owners = channelOwners.get(root) ?? new Map<string, string>()
  const owner = `${packageId}:${contract.id}`
  const previous = owners.get(channel)
  if (previous !== undefined) {
    throw new Error(`API channel collision at ${channel}: ${previous} and ${owner}.`)
  }
  const remove = connection.rpc.handle(channel, async (endpoint, payload, signal, peer) => {
    const methodDefinition = contract.methods[endpoint]
    const handler = registrationParts.handlers[endpoint]
    if (methodDefinition === undefined || typeof handler !== 'function') {
      return {
        ok: false,
        error: {
          code: 'bad-request',
          message: `Unknown API method ${endpoint}.`,
          details: {},
        },
      }
    }
    try {
      throwIfAborted(signal, contract.id, endpoint)
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
        throw error('contract', 'Invalid API request envelope.', contract.id, endpoint, false)
      const envelope = payload as { version?: unknown; input?: unknown }
      if (envelope.version !== contract.version)
        throw error('contract', `API version mismatch for ${contract.id}.`, contract.id, endpoint, false, undefined, 'DSHX6401')
      jsonBytes(envelope.input)
      const input = await validate(methodDefinition.input, envelope.input)
      throwIfAborted(signal, contract.id, endpoint)
      const output = await validate(methodDefinition.output, await handler({ input, ctx, signal, peer } as never))
      throwIfAborted(signal, contract.id, endpoint)
      jsonBytes(output)
      return { ok: true, value: { version: contract.version, output } }
    } catch (cause) {
      if (isApiError(cause))
        return {
          ok: false,
          error: {
            code: cause.remoteCode ?? 'internal',
            message: cause.message,
            details: {},
          },
        }
      if (cause instanceof ContractViolation)
        return {
          ok: false,
          error: { code: 'contract', message: cause.message, details: {} },
        }
      return {
        ok: false,
        error: {
          code: 'internal',
          message: 'API handler failed. See Host diagnostics.',
          details: {},
        },
      }
    }
  })
  owners.set(channel, owner)
  channelOwners.set(root, owners)
  const dispose = async (): Promise<void> => {
    if (owners.get(channel) === owner) owners.delete(channel)
    if (owners.size === 0) channelOwners.delete(root)
    await remove()
  }
  try {
    ctx.effect(() => dispose, `dshx api: ${contract.id}`)
  } catch (cause) {
    await dispose()
    throw cause
  }
}

export function createApiClient<const Methods extends Record<string, AnyApiMethodDefinition>>(
  context: ContextLike | Context | undefined,
  contract: ApiContract<Methods>,
  packageId = 'plugin',
): ApiClient<Methods> {
  const connection = context === undefined || typeof context.get !== 'function' ? undefined : (context.get('connection') as ConnectionLike | undefined)
  const call = async (name: string, input: unknown, options?: ApiCallOptions): Promise<unknown> => {
    const rpc = connection?.rpc
    if (rpc?.call === undefined) throw error('unavailable', 'The DSH Connection provider is unavailable.', contract.id, name, true)
    try {
      throwIfAborted(options?.signal, contract.id, name)
      if (contract.methods[name] === undefined) throw error('contract', `Unknown API method ${name}.`, contract.id, name, false)
      jsonBytes(input)
      throwIfAborted(options?.signal, contract.id, name)
      const result = await rpc.call(apiChannel(packageId, contract.id), name, { version: contract.version, input }, options?.signal)
      throwIfAborted(options?.signal, contract.id, name)
      if (!result.ok) throw errorFromRemote(result, contract.id, name)
      const envelope = result.value as { version?: unknown; output?: unknown }
      if (envelope.version !== contract.version)
        throw error('contract', `API version mismatch for ${contract.id}.`, contract.id, name, false, undefined, 'DSHX6401')
      jsonBytes(envelope.output)
      throwIfAborted(options?.signal, contract.id, name)
      return envelope.output
    } catch (cause) {
      if (isApiError(cause)) throw cause
      if (options?.signal?.aborted) throw aborted(contract.id, name, cause)
      if (cause instanceof ContractViolation) throw error('contract', cause.message, contract.id, name, false, cause)
      throw error('transport', cause instanceof Error ? cause.message : String(cause), contract.id, name, true, cause)
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
          error: isApiError(cause) ? cause : error('transport', String(cause), contract.id, name, true, cause),
        }
      }
    }
  }
  clientConnections.set(client, connection as ConnectionLifecycleLike | undefined)
  return client as ApiClient<Methods>
}

/** Internal lifecycle seam used by the React query adapter. */
export function subscribeApiConnection(client: object, listener: () => void): () => void {
  const source = clientConnections.get(client)?.hostDescription
  return typeof source?.subscribe === 'function' ? source.subscribe(listener) : () => undefined
}

/** Internal snapshot helper; unavailable while the Host generation is down. */
export function apiConnectionAvailable(client: object): boolean {
  const source = clientConnections.get(client)?.hostDescription
  return typeof source?.getSnapshot !== 'function' || source.getSnapshot() !== undefined
}
