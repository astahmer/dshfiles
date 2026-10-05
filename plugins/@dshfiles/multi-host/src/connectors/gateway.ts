import { randomUUID } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { createDshxApiCaller, loopbackLaunchUrl } from '@dshfiles/dshx/platform/host-api'

const maxNativeResponseBytes = 4 * 1024 * 1024
const maxStreamFrameBytes = 2 * 1024 * 1024

const nativeResponseSchema = z
  .object({
    type: z.literal('server-response'),
    rpcId: z.string(),
    result: z.discriminatedUnion('ok', [
      z.object({ ok: z.literal(true), value: z.unknown() }).passthrough(),
      z
        .object({
          ok: z.literal(false),
          error: z.object({ code: z.string().max(128).optional(), message: z.string().max(8192) }).passthrough(),
        })
        .passthrough(),
    ]),
  })
  .passthrough()

const streamFrameSchema = z
  .object({
    streamId: z.string(),
    type: z.enum(['item', 'error', 'end']),
    value: z.unknown().optional(),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
  })
  .passthrough()

export type Gateway = {
  readonly origin: string
  readonly launchUrl: string
  run(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown>
  runSafe(namespace: string, method: string, args: Record<string, unknown>): Promise<GatewayOutcome>
  api(method: string, input?: import('@dshfiles/dshx/platform').JsonValue, signal?: AbortSignal): Promise<unknown>
  follow(endpoint: string, args: unknown, timeoutMs: number): Promise<readonly unknown[]>
  dispose(): Promise<void>
}

export type GatewayOutcome = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: string; readonly message: string }

export class GatewayUnavailableError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'GatewayUnavailableError'
  }
}

interface GatewayTransport {
  readonly origin: string
  readonly launchUrl?: string
  dispose(): Promise<void>
}

export const connectGateway = async ({
  launchUrl,
  createTransport,
  signal,
}: {
  readonly launchUrl: string
  readonly createTransport: (origin: URL, signal?: AbortSignal) => Promise<GatewayTransport>
  readonly signal?: AbortSignal
}): Promise<Gateway> => {
  const parsedLaunch = loopbackLaunchUrl(launchUrl)
  const transport = await createTransport(new URL(parsedLaunch.origin), signal)
  const runtimeLaunchUrl = transport.launchUrl ?? launchUrl
  const runtimeLaunch = loopbackLaunchUrl(runtimeLaunchUrl)
  let exchange: Response
  try {
    exchange = await fetch(runtimeLaunch.origin + '/?token=' + encodeURIComponent(runtimeLaunch.token), {
      redirect: 'manual',
      ...(signal === undefined ? {} : { signal }),
    })
  } catch {
    await transport.dispose()
    if (signal?.aborted) throw new GatewayUnavailableError('cancelled', 'The runtime connection was cancelled.')
    throw new GatewayUnavailableError('gateway-unreachable', 'Could not reach the runtime through its recorded connector.')
  }
  if (exchange.status !== 303 && exchange.status !== 302) {
    await transport.dispose()
    if (exchange.status === 401 || exchange.status === 403) {
      throw new GatewayUnavailableError('authentication-failed', 'The runtime rejected its saved launch credential.')
    }
    throw new GatewayUnavailableError('runtime-not-ready', 'The runtime did not complete its authenticated launch handoff.')
  }
  const cookie = exchange.headers
    .getSetCookie()
    .map(item => item.split(';', 1)[0])
    .filter(Boolean)
    .join('; ')
  if (!cookie) {
    await transport.dispose()
    throw new GatewayUnavailableError('authentication-failed', 'The runtime did not issue an authenticated session cookie.')
  }
  let disposed = false
  const onAbort = (): void => {
    void dispose()
  }
  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    signal?.removeEventListener('abort', onAbort)
    await transport.dispose()
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  if (signal?.aborted) {
    await dispose()
    throw new GatewayUnavailableError('cancelled', 'The runtime connection was cancelled.')
  }
  const callApi = createDshxApiCaller({
    origin: transport.origin,
    cookie,
    packageId: '@dshfiles/multi-host',
    apiId: 'multi-host',
    version: 1,
  })
  return {
    origin: transport.origin,
    launchUrl: runtimeLaunchUrl,
    run: async (namespace, method, args) => {
      const result = await attemptRun({ origin: transport.origin, cookie, namespace, method, args, signal })
      if (!result.ok) throw new GatewayUnavailableError(result.code, result.message)
      return result.value
    },
    runSafe: (namespace, method, args) => attemptRun({ origin: transport.origin, cookie, namespace, method, args, signal }),
    api: callApi,
    follow: (endpoint, args, timeoutMs) => followOnce({ origin: transport.origin, cookie, endpoint, args, timeoutMs, signal }),
    dispose,
  }
}

const followOnce = async ({
  origin,
  cookie,
  endpoint,
  args,
  timeoutMs,
  signal,
}: {
  readonly origin: string
  readonly cookie: string
  readonly endpoint: string
  readonly args: unknown
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}): Promise<readonly unknown[]> => {
  if (!/^[A-Za-z][A-Za-z0-9-]*\/[A-Za-z][A-Za-z0-9-]*$/.test(endpoint)) {
    throw new GatewayUnavailableError('invalid-endpoint', 'The requested runtime stream endpoint is invalid.')
  }
  const url = new URL('/api/remote.mux', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const streamId = randomUUID()
  const socket = new WebSocket(url, { handshakeTimeout: 10_000, maxPayload: maxStreamFrameBytes, headers: { cookie, origin } })
  return new Promise((resolve, reject) => {
    const collected: unknown[] = []
    let opened = false
    let settled = false
    let timeout: ReturnType<typeof setTimeout>
    let absoluteTimeout: ReturnType<typeof setTimeout>
    const finish = (error?: GatewayUnavailableError): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(absoluteTimeout)
      signal?.removeEventListener('abort', onAbort)
      socket.removeAllListeners()
      if (socket.readyState === WebSocket.OPEN) {
        if (error === undefined) socket.send(JSON.stringify({ type: 'cancel', streamId }))
        socket.close()
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.terminate()
      }
      if (error !== undefined) reject(error)
      else resolve(collected)
    }
    const onAbort = (): void => finish(new GatewayUnavailableError('cancelled', 'The runtime stream request was cancelled.'))
    const timeoutError = (): GatewayUnavailableError =>
      new GatewayUnavailableError('stream-timeout', endpoint + ' did not return a snapshot within its time limit.')
    const resetTimeout = (): void => {
      clearTimeout(timeout)
      timeout = setTimeout(() => finish(timeoutError()), timeoutMs)
    }
    timeout = setTimeout(() => finish(timeoutError()), timeoutMs)
    absoluteTimeout = setTimeout(() => finish(timeoutError()), Math.min(Math.max(timeoutMs, 1), 30_000))
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    socket.once('open', () => {
      opened = true
      socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }))
      resetTimeout()
    })
    socket.on('message', data => {
      const text =
        typeof data === 'string'
          ? data
          : Buffer.isBuffer(data)
            ? data.toString('utf8')
            : Array.isArray(data)
              ? Buffer.concat(data).toString('utf8')
              : Buffer.from(data).toString('utf8')
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        finish(new GatewayUnavailableError('invalid-response', 'The runtime stream sent invalid JSON.'))
        return
      }
      const frame = streamFrameSchema.safeParse(raw)
      if (!frame.success) {
        finish(new GatewayUnavailableError('invalid-response', 'The runtime stream sent a malformed frame.'))
        return
      }
      if (frame.data.streamId !== streamId) return
      resetTimeout()
      if (collected.length >= 256) {
        finish(new GatewayUnavailableError('stream-overflow', 'The runtime stream sent too many frames before its snapshot.'))
        return
      }
      if (frame.data.type === 'error') {
        finish(new GatewayUnavailableError(frame.data.error?.code ?? 'stream-error', frame.data.error?.message ?? 'The runtime stream failed.'))
        return
      }
      if (frame.data.type === 'end') {
        if (collected.length === 0) finish(new GatewayUnavailableError('stream-ended', 'The runtime stream ended before its snapshot arrived.'))
        else finish()
        return
      }
      collected.push(frame.data.value)
      const value = frame.data.value
      if (typeof value === 'object' && value !== null && 'type' in value && ['baseline', 'snapshot'].includes(String(value.type))) finish()
    })
    socket.once('error', () => finish(new GatewayUnavailableError('stream-unreachable', 'Could not open the runtime stream.')))
    socket.once('close', () => {
      if (settled) return
      if (opened && collected.length > 0) finish()
      else finish(new GatewayUnavailableError('stream-closed', 'The runtime stream closed before returning a snapshot.'))
    })
  })
}

const attemptRun = async ({
  origin,
  cookie,
  namespace,
  method,
  args,
  signal,
}: {
  readonly origin: string
  readonly cookie: string
  readonly namespace: string
  readonly method: string
  readonly args: Record<string, unknown>
  readonly signal?: AbortSignal
}): Promise<GatewayOutcome> => {
  if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(namespace) || !/^[A-Za-z][A-Za-z0-9-]*$/.test(method)) {
    return { ok: false, code: 'invalid-endpoint', message: 'The requested runtime API endpoint is invalid.' }
  }
  const rpcId = randomUUID()
  let response: Response
  try {
    response = await fetch(origin + '/api/' + encodeURIComponent(namespace) + '/' + encodeURIComponent(method), {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method: namespace + '/' + method, payload: { args } }),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch {
    if (signal?.aborted) return { ok: false, code: 'cancelled', message: 'The runtime API request was cancelled.' }
    return { ok: false, code: 'gateway-unreachable', message: 'Could not reach the runtime API through its connector.' }
  }
  if (response.status === 401)
    return { ok: false, code: 'authentication-expired', message: 'The runtime rejected its authenticated session; reconnect and verify its identity.' }
  if (!response.ok)
    return { ok: false, code: 'gateway-http-error', message: 'The runtime API returned HTTP ' + response.status + ' for ' + namespace + '/' + method + '.' }
  let body: unknown
  try {
    body = JSON.parse(await boundedResponseText(response, maxNativeResponseBytes))
  } catch {
    return { ok: false, code: 'invalid-response', message: 'The runtime API returned invalid JSON.' }
  }
  const parsed = nativeResponseSchema.safeParse(body)
  if (!parsed.success || parsed.data.rpcId !== rpcId) {
    return { ok: false, code: 'invalid-response', message: 'The runtime API returned an invalid RPC envelope.' }
  }
  if (parsed.data.result.ok) return { ok: true, value: parsed.data.result.value }
  return {
    ok: false,
    code: parsed.data.result.error.code ?? 'remote-error',
    message: sanitizeRemoteMessage(parsed.data.result.error.message),
  }
}

const sanitizeRemoteMessage = (message: string): string =>
  message
    .replace(/([?&]token=)[^&\s"']*/gi, '$1[redacted]')
    .replace(/(authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 1000)

const boundedResponseText = async (response: Response, maxBytes: number): Promise<string> => {
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let length = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    const chunk = Buffer.from(result.value)
    length += chunk.byteLength
    if (length > maxBytes) {
      await reader.cancel()
      throw new GatewayUnavailableError('response-too-large', 'The runtime API response exceeded the allowed size.')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
