import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { gunzip, inflate } from 'node:zlib'
import { promisify } from 'node:util'
import { z } from 'zod'
import { pluginAttributes, withSpan, type Span } from '@dshfiles/dshx/tracing'
import type { ReceiverState, ReceiverStatus } from './types.js'

export const MAX_BODY_BYTES = 8 * 1024 * 1024
export const MAX_DECODED_BYTES = 32 * 1024 * 1024
const PORT_RETRY_MS = 30_000
const FORWARD_TIMEOUT_MS = 5_000
const MAX_FORWARDS_IN_FLIGHT = 8

const gunzipAsync = promisify(gunzip)
const inflateAsync = promisify(inflate)

export type ReceiverConfig = {
  readonly enabled: boolean
  readonly host: string
  readonly allowNonLoopback: boolean
  readonly port: number
  readonly forwardUrl: string
}

export type Wire = 'json' | 'protobuf'
export type OtlpSignal = 'traces' | 'metrics' | 'logs'

/** Decodes one signal's body and stores it; throws `RequestRejection` for a client error. */
export type SignalHandler = (input: { readonly body: Buffer; readonly wire: Wire }) => { readonly accepted: number; readonly rejected: number }

export class RequestRejection extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'RequestRejection'
  }
}

const wireOf = (contentType: string | undefined): Wire | null => {
  const mediaType = (contentType ?? '').split(';')[0]?.trim().toLowerCase()
  if (mediaType === 'application/json') return 'json'
  if (mediaType === 'application/x-protobuf' || mediaType === 'application/protobuf') return 'protobuf'
  return null
}

const readBody = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length'] ?? '0')
    if (declared > MAX_BODY_BYTES) {
      reject(new RequestRejection(413, `Request body exceeds ${String(MAX_BODY_BYTES)} bytes.`))
      request.resume()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new RequestRejection(413, `Request body exceeds ${String(MAX_BODY_BYTES)} bytes.`))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })

const decodeContent = async (body: Buffer, encoding: string | undefined): Promise<Buffer> => {
  const normalized = (encoding ?? 'identity').trim().toLowerCase()
  try {
    if (normalized === 'gzip') return await gunzipAsync(body, { maxOutputLength: MAX_DECODED_BYTES })
    if (normalized === 'deflate') return await inflateAsync(body, { maxOutputLength: MAX_DECODED_BYTES })
  } catch {
    throw new RequestRejection(400, `The ${normalized} body could not be decompressed within ${String(MAX_DECODED_BYTES)} bytes.`)
  }
  if (normalized === 'identity' || normalized === '') return body
  throw new RequestRejection(415, `Unsupported content-encoding ${normalized}.`)
}

const forwardUrlSchema = z.url({ protocol: /^https?$/ })

/** A base URL like `http://127.0.0.1:4319`; `/v1/traces` and `/v1/metrics` are appended. Empty turns forwarding off. */
type ForwardTarget = { readonly url: URL | null; readonly error: string | null }

const parseForwardUrl = (text: string): ForwardTarget => {
  const trimmed = text.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return { url: null, error: null }
  const parsed = forwardUrlSchema.safeParse(trimmed)
  if (!parsed.success) return { url: null, error: 'The forward URL must be an http(s) URL.' }
  return { url: new URL(parsed.data), error: null }
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

const isLoopbackHost = (host: string): boolean => LOOPBACK_HOSTS.has(host.trim().toLowerCase()) || host.trim().startsWith('127.')

const pointsAt = (url: URL, port: number): boolean => {
  const urlPort = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
  return LOOPBACK_HOSTS.has(url.hostname) && urlPort === port
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300)

const createReceiver = (options: {
  readonly handlers: Partial<Record<OtlpSignal, SignalHandler>>
  readonly onWarning?: (message: string) => void
  /** Called after every state change (listening, port in use, failed, disabled), e.g. to publish the bound address. */
  readonly onStateChange?: () => void
  readonly now?: () => number
  readonly fetch?: typeof fetch
}) => {
  const now = options.now ?? Date.now
  const send = options.fetch ?? fetch
  let config: ReceiverConfig = { enabled: false, host: '127.0.0.1', allowNonLoopback: false, port: 0, forwardUrl: '' }
  let server: Server | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let state: ReceiverState = 'disabled'
  let message: string | null = null
  let boundPort: number | null = null
  let startedAt: number | null = null
  let generation = 0
  let forwardsInFlight = 0
  const counters = {
    requests: { traces: 0, metrics: 0, logs: 0 } satisfies Record<OtlpSignal, number>,
    accepted: { traces: 0, metrics: 0, logs: 0 } satisfies Record<OtlpSignal, number>,
    rejectedRequests: 0,
    rejectedItems: 0,
    forwarded: 0,
    forwardFailures: 0,
  }
  let lastReceivedAt: number | null = null
  let forwardError: string | null = null

  const notifyStateChange = (): void => {
    try {
      options.onStateChange?.()
    } catch (error) {
      options.onWarning?.(`traces receiver: ${describeError(error)}`)
    }
  }

  const forwardTarget = (): URL | null => {
    const parsed = parseForwardUrl(config.forwardUrl)
    if (parsed.url === null || (boundPort !== null && pointsAt(parsed.url, boundPort))) return null
    return parsed.url
  }

  const forward = (signal: OtlpSignal, body: Buffer, headers: IncomingMessage['headers']): void => {
    const target = forwardTarget()
    if (target === null) return
    if (forwardsInFlight >= MAX_FORWARDS_IN_FLIGHT) {
      counters.forwardFailures += 1
      forwardError = 'Dropped: too many forwards in flight.'
      return
    }
    forwardsInFlight += 1
    const forwardHeaders = new Headers({ 'content-type': headers['content-type'] ?? 'application/json' })
    const encoding = headers['content-encoding']
    if (encoding !== undefined) forwardHeaders.set('content-encoding', encoding)
    void send(new URL(`${target.pathname.replace(/\/+$/, '')}/v1/${signal}`, target), {
      method: 'POST',
      headers: forwardHeaders,
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    })
      .then(response => {
        if (response.ok) counters.forwarded += 1
        else {
          counters.forwardFailures += 1
          forwardError = `HTTP ${String(response.status)} from ${target.origin}`
        }
        return response.body?.cancel()
      })
      .catch((error: unknown) => {
        counters.forwardFailures += 1
        forwardError = describeError(error)
      })
      .finally(() => {
        forwardsInFlight -= 1
      })
  }

  const respond = (response: ServerResponse, status: number, wire: Wire | null, errorMessage?: string): void => {
    if (response.headersSent) return
    if (wire === 'protobuf' && status === 200) {
      response.writeHead(200, { 'content-type': 'application/x-protobuf', 'content-length': '0' }).end()
      return
    }
    const body = status === 200 ? '{}' : JSON.stringify({ code: status, message: errorMessage ?? 'Rejected.' })
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }).end(body)
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = new URL(request.url ?? '/', 'http://receiver').pathname
    const signal: OtlpSignal | null = path === '/v1/traces' ? 'traces' : path === '/v1/metrics' ? 'metrics' : path === '/v1/logs' ? 'logs' : null
    const handler = signal === null ? undefined : options.handlers[signal]
    if (signal === null || handler === undefined) throw new RequestRejection(404, `Not an OTLP path this receiver serves: ${path.slice(0, 80)}`)
    if (request.method !== 'POST') throw new RequestRejection(405, 'Use POST.')
    const wire = wireOf(request.headers['content-type'])
    if (wire === null) throw new RequestRejection(415, 'Send application/json or application/x-protobuf.')
    const store = async (span?: Span): Promise<void> => {
      const raw = await readBody(request)
      const result = handler({ body: await decodeContent(raw, request.headers['content-encoding']), wire })
      counters.requests[signal] += 1
      counters.accepted[signal] += result.accepted
      counters.rejectedItems += result.rejected
      lastReceivedAt = now()
      span?.setAttributes(pluginAttributes({ plugin: 'traces', attributes: { body_bytes: raw.length, accepted: result.accepted, rejected: result.rejected } }))
      forward(signal, raw, request.headers)
      respond(response, 200, wire)
    }
    // A span per /v1/traces request would be exported back into this receiver with every batch, forever; the
    // traces_status counters observe those requests instead.
    if (signal === 'traces') return store()
    return withSpan('otlp ingest', { kind: 'server', attributes: pluginAttributes({ plugin: 'traces', attributes: { signal, wire } }) }, store)
  }

  const onRequest = (request: IncomingMessage, response: ServerResponse): void => {
    handle(request, response).catch((error: unknown) => {
      counters.rejectedRequests += 1
      if (error instanceof RequestRejection) {
        respond(response, error.status, null, error.message)
        return
      }
      options.onWarning?.(`traces receiver: ${describeError(error)}`)
      respond(response, 500, null, 'The receiver could not store this request.')
    })
  }

  const closeServer = async (): Promise<void> => {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot: `server` is cleared before the close settles
    const current = server
    server = null
    boundPort = null
    if (current === null) return
    current.closeAllConnections()
    await new Promise<void>(resolve => current.close(() => resolve()))
  }

  const listen = (attempt: number): Promise<void> =>
    new Promise(settle => {
      if (attempt !== generation || !config.enabled) {
        settle()
        return
      }
      const candidate = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, onRequest)
      candidate.once('error', (error: NodeJS.ErrnoException) => {
        settle()
        if (attempt !== generation) return
        if (error.code === 'EADDRINUSE') {
          state = 'port-in-use'
          message = `Port ${String(config.port)} on ${config.host} is held by another process (an OpenTelemetry collector or dsh-traces, for instance). Stored traces stay browsable; the receiver retries every ${String(PORT_RETRY_MS / 1000)} s.`
          retryTimer = setTimeout(() => void listen(attempt), PORT_RETRY_MS)
          retryTimer.unref()
          notifyStateChange()
          return
        }
        state = 'failed'
        message = describeError(error)
        notifyStateChange()
      })
      candidate.listen({ host: config.host, port: config.port, exclusive: true }, () => {
        settle()
        if (attempt !== generation) {
          candidate.close()
          return
        }
        server = candidate
        const address = candidate.address()
        boundPort = typeof address === 'object' && address !== null ? address.port : config.port
        state = 'listening'
        startedAt = now()
        const forwardError = parseForwardUrl(config.forwardUrl).error
        const loops = config.forwardUrl.trim() !== '' && forwardTarget() === null && forwardError === null
        message = forwardError ?? (loops ? 'The forward URL points at this receiver; forwarding is off.' : null)
        notifyStateChange()
      })
    })

  const apply = async (next: ReceiverConfig): Promise<void> => {
    const unchanged =
      next.enabled === config.enabled &&
      next.port === config.port &&
      next.host === config.host &&
      next.allowNonLoopback === config.allowNonLoopback &&
      state !== 'failed'
    config = next
    if (unchanged && next.enabled) return
    generation += 1
    await closeServer()
    if (!next.enabled) {
      state = 'disabled'
      message = null
      notifyStateChange()
      return
    }
    if (!isLoopbackHost(next.host) && !next.allowNonLoopback) {
      state = 'failed'
      message = `Refusing to listen on ${next.host}: a non-loopback address exposes the receiver to the network. Turn on "Allow a non-loopback address" to opt in.`
      notifyStateChange()
      return
    }
    state = 'starting'
    message = null
    notifyStateChange()
    await listen(generation)
  }

  const status = (): Omit<ReceiverStatus, 'store' | 'mode' | 'externalViewerUrl'> => ({
    state,
    address: config.host,
    configuredPort: config.port,
    boundPort,
    message,
    startedAt,
    requests: { ...counters.requests },
    accepted: { ...counters.accepted },
    rejectedRequests: counters.rejectedRequests,
    rejectedItems: counters.rejectedItems,
    lastReceivedAt,
    forward: {
      url: forwardTarget()?.toString() ?? null,
      forwarded: counters.forwarded,
      failures: counters.forwardFailures,
      lastError: forwardError,
    },
  })

  const stop = async (): Promise<void> => {
    generation += 1
    state = 'disabled'
    await closeServer()
    notifyStateChange()
  }

  return { apply, status, stop }
}

export class OtlpReceiver {
  static readonly create = createReceiver
  static readonly parseForwardUrl = parseForwardUrl
  static readonly pointsAt = pointsAt
}

export type Receiver = ReturnType<typeof createReceiver>
