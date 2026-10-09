import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute, ConnectionRpcHandler, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { ApiHostRegistration } from './types.js'
import { apiHostRegistrationParts } from './define.js'
import { apiChannel, ContractViolation, error, isApiError, isPluginApiError, jsonBytes, throwIfAborted, validate } from './common.js'

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

export async function registerApi(ctx: Context, packageId: string, registration: ApiHostRegistration): Promise<void> {
  const registrationParts = apiHostRegistrationParts(registration)
  const contract = registrationParts.contract
  const connection = ctx.get('connection') as HostConnectionHandle | undefined
  if (connection?.fetch?.register === undefined) {
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
  const dispatch: ConnectionRpcHandler = async (endpoint, payload, signal, peer) => {
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
      if (isPluginApiError(cause))
        return {
          ok: false,
          error: { code: cause.code, message: cause.message, details: {} },
        }
      hostLogger(ctx).error(`API handler ${packageId} ${contract.id}.${endpoint} failed: ${describeFailure(cause)}`)
      return {
        ok: false,
        error: {
          code: 'internal',
          message: 'API handler failed. See Host diagnostics.',
          details: {},
        },
      }
    }
  }
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
          const result = await dispatch(method, message.payload, request.signal, connection.operator)
          return Response.json(serverResponseSchema.parse({ type: 'server-response', rpcId: message.rpcId, result }))
        },
      }
      removeRoutes.push(connection.fetch.register(route))
    }
  } catch (cause) {
    await Promise.all(removeRoutes.map(remove => remove()))
    throw cause
  }
  owners.set(channel, owner)
  channelOwners.set(root, owners)
  const dispose = async (): Promise<void> => {
    if (owners.get(channel) === owner) owners.delete(channel)
    if (owners.size === 0) channelOwners.delete(root)
    await Promise.all(removeRoutes.map(remove => remove()))
  }
  try {
    ctx.effect(() => dispose, `dshx api: ${contract.id}`)
  } catch (cause) {
    await dispose()
    throw cause
  }
}
