import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { createDshxApiCaller, loopbackLaunchUrl } from '@dshfiles/dshx/platform/host-api'
import type { JsonValue } from '@dshfiles/dshx/platform'
import { Cause, Duration, Effect, Option, Queue, Schema, type Scope, Stream } from 'effect'
import { Cookies, FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { WebSocket } from 'ws'
import {
  ApiUnreachable,
  AuthenticationExpired,
  AuthenticationFailed,
  GatewayHttpError,
  GatewayUnreachable,
  InvalidEndpoint,
  InvalidResponse,
  InvalidRuntimeLocator,
  RemoteApiFailed,
  RemoteRequestFailed,
  RequestTooLarge,
  ResponseTooLarge,
  RuntimeNotReady,
  StreamClosed,
  StreamEnded,
  StreamFailed,
  StreamOverflow,
  StreamTimedOut,
  StreamUnreachable,
  failureCodeOf,
  type GatewayRequestError,
  type GatewayStreamError,
  type PluginApiError,
} from '../errors.js'

const maxNativeResponseBytes = 32 * 1024 * 1024
const maxNativeRequestBytes = 48 * 1024 * 1024
const maxStreamFrameBytes = 2 * 1024 * 1024
const maxFollowFrames = 256

const passthrough = <S extends Schema.Struct.Fields>(fields: S) => Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)])

const nativeResponseSchema = passthrough({
  type: Schema.Literal('server-response'),
  rpcId: Schema.String,
  result: Schema.Union([
    passthrough({ ok: Schema.Literal(true), value: Schema.Unknown }),
    passthrough({
      ok: Schema.Literal(false),
      error: passthrough({ code: Schema.optional(Schema.String.check(Schema.isMaxLength(128))), message: Schema.String.check(Schema.isMaxLength(8192)) }),
    }),
  ]),
})
const decodeNativeResponse = Schema.decodeUnknownOption(Schema.fromJsonString(nativeResponseSchema))

const streamFrameSchema = passthrough({
  streamId: Schema.String,
  type: Schema.Literals(['item', 'error', 'end']),
  value: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ code: Schema.optional(Schema.String), message: Schema.optional(Schema.String) })),
})
const decodeStreamFrame = Schema.decodeUnknownOption(Schema.fromJsonString(streamFrameSchema))
const snapshotTypeSchema = Schema.Struct({ type: Schema.Literals(['baseline', 'snapshot']) })
const isSnapshot = Schema.is(snapshotTypeSchema)

const endpointPattern = /^[A-Za-z][A-Za-z0-9-]*\/[A-Za-z][A-Za-z0-9-]*$/
const segmentPattern = /^[A-Za-z][A-Za-z0-9-]*$/

const sanitizeRemoteMessage = (message: string): string =>
  message
    .replace(/([?&]token=)[^&\s"']*/gi, '$1[redacted]')
    .replace(/(authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 1000)

/** What a connector provides under the gateway: an origin that reaches the runtime, for the gateway's Scope. */
export interface GatewayTransport {
  readonly origin: string
  readonly launchUrl?: string
  /** Completes when the transport went away on its own (an SSH tunnel that exited). */
  readonly closed: Effect.Effect<void>
}

export interface PluginApiTarget {
  readonly packageId: string
  readonly apiId: string
  readonly version: number
}

export interface NativeRequest {
  readonly namespace: string
  readonly method: string
  readonly args: Record<string, unknown>
}

export interface StreamRequest {
  readonly endpoint: string
  readonly args: unknown
}

/** One authenticated connection to a DSH runtime; it lives as long as the Scope it was opened in. */
export interface Gateway {
  readonly origin: string
  readonly launchUrl: string
  readonly closed: Effect.Effect<void>
  /** One native runtime request; a failure the runtime reports is `RemoteRequestFailed` with its own code. */
  readonly run: (request: NativeRequest) => Effect.Effect<unknown, GatewayRequestError>
  /** This plugin's own API on the connected runtime. */
  readonly api: (method: string, input?: JsonValue) => Effect.Effect<unknown, PluginApiError>
  /** Another plugin's dshx API on the connected runtime. */
  readonly pluginApi: (target: PluginApiTarget) => (method: string, input?: JsonValue) => Effect.Effect<unknown, PluginApiError>
  /** Read one stream until its first snapshot (or baseline) frame and return every frame up to it. */
  readonly follow: (request: StreamRequest & { readonly timeout: Duration.Input }) => Effect.Effect<readonly unknown[], GatewayStreamError>
  /** Every item of one long-lived stream until it ends; interrupting the consumer cancels it on the runtime. */
  readonly stream: (request: StreamRequest) => Stream.Stream<unknown, GatewayStreamError>
}

const textOf = (data: WebSocket.RawData): string => {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/** The frames of one mux stream; a socket that closes after opening fails with `StreamClosed`. */
const frames = (input: { readonly origin: string; readonly cookie: string; readonly request: StreamRequest }) =>
  Stream.callback<unknown, GatewayStreamError>(queue =>
    Effect.gen(function* () {
      if (!endpointPattern.test(input.request.endpoint)) return yield* new InvalidEndpoint()
      const url = new URL('/api/remote.mux', input.origin)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const streamId = randomUUID()
      const state = { settled: false }
      const settle = (cause: Cause.Cause<GatewayStreamError | Cause.Done>): void => {
        if (state.settled) return
        state.settled = true
        Queue.failCauseUnsafe(queue, cause)
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const socket = new WebSocket(url, {
            handshakeTimeout: 10_000,
            maxPayload: maxStreamFrameBytes,
            headers: { cookie: input.cookie, origin: input.origin },
          })
          socket.once('open', () =>
            socket.send(JSON.stringify({ type: 'open', streamId, endpoint: input.request.endpoint, payload: { args: input.request.args } })),
          )
          socket.on('message', data => {
            const frame = decodeStreamFrame(textOf(data))
            if (Option.isNone(frame)) return settle(Cause.fail(new InvalidResponse()))
            if (frame.value.streamId !== streamId) return
            if (frame.value.type === 'error') {
              return settle(
                Cause.fail(
                  new StreamFailed({
                    code: (frame.value.error?.code ?? 'stream-error').slice(0, 128),
                    detail: sanitizeRemoteMessage(frame.value.error?.message ?? 'The runtime stream failed.'),
                  }),
                ),
              )
            }
            if (frame.value.type === 'end') return settle(Cause.fail(Cause.Done()))
            Queue.offerUnsafe(queue, frame.value.value)
          })
          socket.once('error', () => settle(Cause.fail(new StreamUnreachable())))
          socket.once('close', () => settle(Cause.fail(new StreamClosed())))
          return socket
        }),
        socket =>
          Effect.sync(() => {
            const cancelled = !state.settled
            state.settled = true
            socket.removeAllListeners()
            // terminate() during the handshake emits 'error' on the next tick; with no listener that would crash the Host.
            socket.on('error', () => undefined)
            if (socket.readyState === WebSocket.OPEN) {
              if (cancelled) socket.send(JSON.stringify({ type: 'cancel', streamId }))
              socket.close()
              return
            }
            if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
          }),
      )
    }),
  )

/** The body as text, failing as soon as it grows past `maxBytes` instead of buffering it whole. */
const boundedText = <E>(input: { readonly stream: Stream.Stream<Uint8Array, E>; readonly maxBytes: number }) =>
  Stream.runFoldEffect(
    Stream.mapError(input.stream, (): ResponseTooLarge | InvalidResponse => new InvalidResponse()),
    () => ({ chunks: new Array<Uint8Array>(), bytes: 0 }),
    (state, chunk) => {
      const bytes = state.bytes + chunk.byteLength
      if (bytes > input.maxBytes) return Effect.fail(new ResponseTooLarge())
      state.chunks.push(chunk)
      return Effect.succeed({ chunks: state.chunks, bytes })
    },
  ).pipe(Effect.map(state => Buffer.concat(state.chunks).toString('utf8')))

const pluginApiError = (cause: unknown): PluginApiError => {
  const code = cause instanceof Error && 'code' in cause && typeof cause.code === 'string' ? cause.code : 'api-unreachable'
  if (code === 'api-unreachable') return new ApiUnreachable({ cause })
  if (code === 'authentication-expired') return new AuthenticationExpired()
  return new RemoteApiFailed({ code: code.slice(0, 128), cause })
}

/**
 * Authenticate through the runtime's tokenized launch URL over `transport`, then return the gateway. The transport and
 * every stream the gateway opens live in the caller's Scope.
 */
export const connectGateway = Effect.fn('multi-host gateway connect')(function* <E, R>(input: {
  readonly launchUrl: string
  readonly transport: (origin: URL) => Effect.Effect<GatewayTransport, E, R | Scope.Scope>
}) {
  const client = yield* HttpClient.HttpClient
  const launch = yield* Effect.try({ try: () => loopbackLaunchUrl(input.launchUrl), catch: cause => new InvalidRuntimeLocator({ cause }) })
  const transport = yield* input.transport(new URL(launch.origin))
  const runtimeLaunchUrl = transport.launchUrl ?? input.launchUrl
  const runtimeLaunch = yield* Effect.try({ try: () => loopbackLaunchUrl(runtimeLaunchUrl), catch: cause => new InvalidRuntimeLocator({ cause }) })
  const exchange = yield* client.get(`${runtimeLaunch.origin}/?token=${encodeURIComponent(runtimeLaunch.token)}`).pipe(
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'manual' }),
    Effect.mapError(cause => new GatewayUnreachable({ cause })),
  )
  if (exchange.status === 401 || exchange.status === 403) return yield* new AuthenticationFailed()
  if (exchange.status !== 303 && exchange.status !== 302) return yield* new RuntimeNotReady()
  if (Cookies.isEmpty(exchange.cookies)) return yield* new AuthenticationFailed()
  const cookie = Cookies.toCookieHeader(exchange.cookies)
  const origin = transport.origin

  /** One span per native runtime request: endpoint and outcome code only, never the arguments or the reply. */
  const run = (request: NativeRequest): Effect.Effect<unknown, GatewayRequestError> =>
    Effect.gen(function* () {
      if (!segmentPattern.test(request.namespace) || !segmentPattern.test(request.method)) return yield* new InvalidEndpoint()
      const rpcId = randomUUID()
      const body = JSON.stringify({ type: 'client-request', rpcId, method: `${request.namespace}/${request.method}`, payload: { args: request.args } })
      if (Buffer.byteLength(body, 'utf8') > maxNativeRequestBytes) return yield* new RequestTooLarge()
      const response = yield* client
        .execute(
          HttpClientRequest.post(`${origin}/api/${encodeURIComponent(request.namespace)}/${encodeURIComponent(request.method)}`).pipe(
            HttpClientRequest.setHeader('cookie', cookie),
            HttpClientRequest.bodyText(body, 'application/json'),
          ),
        )
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
          Effect.mapError(cause => new GatewayUnreachable({ cause })),
        )
      if (response.status === 401) return yield* new AuthenticationExpired()
      if (response.status < 200 || response.status >= 300)
        return yield* new GatewayHttpError({ endpoint: `${request.namespace}/${request.method}`, status: response.status })
      const text = yield* boundedText({ stream: response.stream, maxBytes: maxNativeResponseBytes })
      const envelope = decodeNativeResponse(text)
      if (Option.isNone(envelope) || envelope.value.rpcId !== rpcId) return yield* new InvalidResponse()
      const result = envelope.value.result
      if (result.ok) return result.value
      return yield* new RemoteRequestFailed({ code: result.error.code ?? 'remote-error', detail: sanitizeRemoteMessage(result.error.message) })
    }).pipe(
      Effect.tap(() => Effect.annotateCurrentSpan('multi_host.outcome', 'ok')),
      Effect.tapError(error => Effect.annotateCurrentSpan('multi_host.outcome', failureCodeOf(error))),
      Effect.withSpan(`${request.namespace}/${request.method}`, {
        kind: 'client',
        attributes: {
          'rpc.system': 'dsh-native',
          'rpc.service': request.namespace,
          'rpc.method': request.method,
          'dshx.plugin.package': '@dshfiles/multi-host',
        },
      }),
    )

  const pluginApi = (target: PluginApiTarget) => {
    const call = createDshxApiCaller({ origin, cookie, ...target })
    return (method: string, input?: JsonValue) => Effect.tryPromise({ try: signal => call(method, input, signal), catch: pluginApiError })
  }

  const follow = Effect.fn('multi-host stream follow')(function* (request: StreamRequest & { readonly timeout: Duration.Input }) {
    const collected: unknown[] = []
    const timedOut = () => new StreamTimedOut({ endpoint: request.endpoint })
    const absolute = Duration.min(Duration.max(Duration.fromInputUnsafe(request.timeout), Duration.millis(1)), Duration.seconds(30))
    yield* frames({ origin, cookie, request }).pipe(
      Stream.timeoutOrElse({ duration: request.timeout, orElse: () => Stream.fail(timedOut()) }),
      Stream.runForEachWhile(value =>
        Effect.suspend(() => {
          if (collected.length >= maxFollowFrames) return Effect.fail(new StreamOverflow())
          collected.push(value)
          return Effect.succeed(!isSnapshot(value))
        }),
      ),
      Effect.catchTag('StreamClosed', error => (collected.length > 0 ? Effect.void : Effect.fail(error))),
      Effect.timeoutOrElse({ duration: absolute, orElse: () => Effect.fail(timedOut()) }),
    )
    if (collected.length === 0) return yield* new StreamEnded()
    return collected
  })

  return {
    origin,
    launchUrl: runtimeLaunchUrl,
    closed: transport.closed,
    run,
    api: pluginApi({ packageId: '@dshfiles/multi-host', apiId: 'multi-host', version: 1 }),
    pluginApi,
    follow,
    stream: request => frames({ origin, cookie, request }).pipe(Stream.catchTag('StreamClosed', () => Stream.empty)),
  } satisfies Gateway
})
