import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { gunzip, inflate } from 'node:zlib'
import { DshxPlugin } from '@dshfiles/dshx/effect'
import { pluginAttributes } from '@dshfiles/dshx/tracing'
import { Cause, Clock, Context, Duration, Effect, FiberHandle, FiberSet, Layer, Ref, Schedule, Stream, SubscriptionRef } from 'effect'
import { Forwarder, type ForwardStatus } from './forwarder.js'
import { OtlpIngest } from './otlp-ingest.js'
import type { OtlpSignal, Wire } from './otlp/decode.js'
import { NonLoopbackRefused, OtlpRequestRejected, PORT_RETRY_SECONDS, PortInUse, ReceiverListenFailed } from './receiver-errors.js'
import { type ListenConfig, TracesSettingsModel, TracesSettingsService } from './settings.js'
import type { ReceiverState } from './types.js'

export const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_DECODED_BYTES = 32 * 1024 * 1024

const SIGNAL_BY_PATH = new Map<string, OtlpSignal>([
  ['/v1/traces', 'traces'],
  ['/v1/metrics', 'metrics'],
  ['/v1/logs', 'logs'],
])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

const isLoopbackHost = (host: string): boolean => LOOPBACK_HOSTS.has(host.trim().toLowerCase()) || host.trim().startsWith('127.')

/** Where the listener stands; the counters live beside it so a request never rewrites this. */
export type ListenStatus = {
  readonly state: ReceiverState
  readonly address: string
  readonly configuredPort: number
  readonly boundPort: number | null
  readonly message: string | null
  readonly startedAt: number | null
}

export type ReceiverSnapshot = ListenStatus & {
  readonly requests: Record<OtlpSignal, number>
  readonly accepted: Record<OtlpSignal, number>
  readonly rejectedRequests: number
  readonly rejectedItems: number
  readonly lastReceivedAt: number | null
  readonly forward: ForwardStatus
}

type Counters = {
  readonly requests: Record<OtlpSignal, number>
  readonly accepted: Record<OtlpSignal, number>
  readonly rejectedRequests: number
  readonly rejectedItems: number
  readonly lastReceivedAt: number | null
}

const wireOf = (contentType: string | undefined): Wire | null => {
  const mediaType = (contentType ?? '').split(';')[0]?.trim().toLowerCase()
  if (mediaType === 'application/json') return 'json'
  if (mediaType === 'application/x-protobuf' || mediaType === 'application/protobuf') return 'protobuf'
  return null
}

const tooLarge = () => new OtlpRequestRejected({ status: 413, reason: `Request body exceeds ${String(MAX_BODY_BYTES)} bytes.` })

const readBody = (request: IncomingMessage): Effect.Effect<Buffer, OtlpRequestRejected> =>
  Effect.callback<Buffer, OtlpRequestRejected>(resume => {
    const declared = Number(request.headers['content-length'] ?? '0')
    if (declared > MAX_BODY_BYTES) {
      request.resume()
      resume(Effect.fail(tooLarge()))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        request.destroy()
        resume(Effect.fail(tooLarge()))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resume(Effect.succeed(Buffer.concat(chunks))))
    request.on('error', cause => resume(Effect.fail(new OtlpRequestRejected({ status: 400, reason: 'The request body could not be read.', cause }))))
  })

const decompress = (input: { readonly body: Buffer; readonly encoding: 'gzip' | 'deflate' }): Effect.Effect<Buffer, OtlpRequestRejected> =>
  Effect.callback<Buffer, OtlpRequestRejected>(resume => {
    const done = (cause: Error | null, result: Buffer) =>
      resume(
        cause === null
          ? Effect.succeed(result)
          : Effect.fail(
              new OtlpRequestRejected({
                status: 400,
                reason: `The ${input.encoding} body could not be decompressed within ${String(MAX_DECODED_BYTES)} bytes.`,
                cause,
              }),
            ),
      )
    if (input.encoding === 'gzip') gunzip(input.body, { maxOutputLength: MAX_DECODED_BYTES }, done)
    else inflate(input.body, { maxOutputLength: MAX_DECODED_BYTES }, done)
  })

const decodeContent = (body: Buffer, contentEncoding: string | undefined): Effect.Effect<Buffer, OtlpRequestRejected> => {
  const encoding = (contentEncoding ?? 'identity').trim().toLowerCase()
  if (encoding === 'gzip' || encoding === 'deflate') return decompress({ body, encoding })
  if (encoding === 'identity' || encoding === '') return Effect.succeed(body)
  return Effect.fail(new OtlpRequestRejected({ status: 415, reason: `Unsupported content-encoding ${encoding}.` }))
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

const describe = (error: Error): string => error.message.slice(0, 300)

const listen = (config: ListenConfig, onRequest: (request: IncomingMessage, response: ServerResponse) => void) =>
  Effect.callback<Server, PortInUse | ReceiverListenFailed>(resume => {
    const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, onRequest)
    server.once('error', (error: NodeJS.ErrnoException) =>
      resume(
        Effect.fail(
          error.code === 'EADDRINUSE'
            ? new PortInUse({ host: config.host, port: config.port, cause: error })
            : new ReceiverListenFailed({ host: config.host, port: config.port, reason: describe(error), cause: error }),
        ),
      ),
    )
    server.listen({ host: config.host, port: config.port, exclusive: true }, () => resume(Effect.succeed(server)))
    return Effect.sync(() => server.close())
  })

const close = (server: Server) =>
  Effect.callback<void>(resume => {
    server.closeAllConnections()
    server.close(() => resume(Effect.void))
  })

const emptyCounts = () => ({ traces: 0, metrics: 0, logs: 0 }) satisfies Record<OtlpSignal, number>

/** The OTLP/HTTP listener: one server per listen configuration, replaced (old one closed first) whenever that configuration changes. */
export class Receiver extends Context.Service<
  Receiver,
  {
    readonly status: Effect.Effect<ReceiverSnapshot>
    readonly changes: Stream.Stream<ListenStatus>
  }
>()('@dshfiles/traces/Receiver') {
  static readonly layer = Layer.effect(
    Receiver,
    Effect.gen(function* () {
      const settings = yield* TracesSettingsService
      const ingest = yield* OtlpIngest
      const forwarder = yield* Forwarder
      const initial = TracesSettingsModel.listenConfigOf(yield* settings.get)
      const listenStatus = yield* SubscriptionRef.make<ListenStatus>({
        state: 'disabled',
        address: initial.host,
        configuredPort: initial.port,
        boundPort: null,
        message: null,
        startedAt: null,
      })
      const counters = yield* Ref.make<Counters>({
        requests: emptyCounts(),
        accepted: emptyCounts(),
        rejectedRequests: 0,
        rejectedItems: 0,
        lastReceivedAt: null,
      })
      const server = yield* FiberHandle.make()
      const setStatus = (patch: Partial<ListenStatus>) => SubscriptionRef.update(listenStatus, current => ({ ...current, ...patch }))
      const rejected = Ref.update(counters, current => ({ ...current, rejectedRequests: current.rejectedRequests + 1 }))

      const store = Effect.fnUntraced(function* (input: {
        readonly request: IncomingMessage
        readonly response: ServerResponse
        readonly signal: OtlpSignal
        readonly wire: Wire
      }) {
        const raw = yield* readBody(input.request)
        const result = yield* ingest.ingest(input.signal, { body: yield* decodeContent(raw, input.request.headers['content-encoding']), wire: input.wire })
        const receivedAt = yield* Clock.currentTimeMillis
        yield* Ref.update(counters, current => ({
          ...current,
          requests: { ...current.requests, [input.signal]: current.requests[input.signal] + 1 },
          accepted: { ...current.accepted, [input.signal]: current.accepted[input.signal] + result.accepted },
          rejectedItems: current.rejectedItems + result.rejected,
          lastReceivedAt: receivedAt,
        }))
        const boundPort = (yield* SubscriptionRef.get(listenStatus)).boundPort
        yield* forwarder.forward({ signal: input.signal, body: raw, headers: input.request.headers, boundPort })
        respond(input.response, 200, input.wire)
        return { bodyBytes: raw.length, accepted: result.accepted, rejected: result.rejected }
      })

      const handle = Effect.fnUntraced(function* (request: IncomingMessage, response: ServerResponse) {
        const path = new URL(request.url ?? '/', 'http://receiver').pathname
        const signal = SIGNAL_BY_PATH.get(path)
        if (signal === undefined) return yield* new OtlpRequestRejected({ status: 404, reason: `Not an OTLP path this receiver serves: ${path.slice(0, 80)}` })
        if (request.method !== 'POST') return yield* new OtlpRequestRejected({ status: 405, reason: 'Use POST.' })
        const wire = wireOf(request.headers['content-type'])
        if (wire === null) return yield* new OtlpRequestRejected({ status: 415, reason: 'Send application/json or application/x-protobuf.' })
        const stored = store({ request, response, signal, wire }).pipe(Effect.withTracerEnabled(false))
        // A span per /v1/traces request would be exported back into this receiver with every batch, forever; the
        // traces_status counters observe those requests instead.
        if (signal === 'traces') return yield* stored
        return yield* Effect.withSpan(
          Effect.gen(function* () {
            const outcome = yield* stored
            yield* Effect.annotateCurrentSpan(
              pluginAttributes({ plugin: 'traces', attributes: { body_bytes: outcome.bodyBytes, accepted: outcome.accepted, rejected: outcome.rejected } }),
            )
          }),
          'otlp ingest',
          { kind: 'server', root: true, attributes: pluginAttributes({ plugin: 'traces', attributes: { signal, wire } }) },
        )
      })

      const answer = (request: IncomingMessage, response: ServerResponse) =>
        handle(request, response).pipe(
          Effect.catchTag('OtlpRequestRejected', error =>
            Effect.andThen(
              rejected,
              Effect.sync(() => respond(response, error.status, null, error.message)),
            ),
          ),
          Effect.catchCause(cause =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.andThen(
                  rejected,
                  Effect.logWarning('traces receiver could not store a request', cause).pipe(
                    Effect.andThen(Effect.sync(() => respond(response, 500, null, 'The receiver could not store this request.'))),
                  ),
                ),
          ),
        )

      const bind = (config: ListenConfig) =>
        Effect.scoped(
          Effect.gen(function* () {
            const run = yield* FiberSet.makeRuntime<never>()
            const bound = yield* Effect.acquireRelease(
              listen(config, (request, response) => {
                run(answer(request, response))
              }),
              close,
            )
            const address = bound.address()
            yield* setStatus({
              state: 'listening',
              boundPort: typeof address === 'object' && address !== null ? address.port : config.port,
              startedAt: yield* Clock.currentTimeMillis,
              message: null,
            })
            return yield* Effect.never
          }),
        )

      const serve = Effect.fnUntraced(function* (config: ListenConfig) {
        const listening = { address: config.host, configuredPort: config.port, boundPort: null }
        if (!config.enabled) return yield* setStatus({ ...listening, state: 'disabled', message: null })
        if (!isLoopbackHost(config.host) && !config.allowNonLoopback)
          return yield* setStatus({ ...listening, state: 'failed', message: new NonLoopbackRefused({ host: config.host }).message })
        yield* setStatus({ ...listening, state: 'starting', message: null })
        yield* bind(config).pipe(
          Effect.tapError(error => (error._tag === 'PortInUse' ? setStatus({ state: 'port-in-use', message: error.message }) : Effect.void)),
          Effect.retry({ while: error => error._tag === 'PortInUse', schedule: Schedule.spaced(Duration.seconds(PORT_RETRY_SECONDS)) }),
          Effect.catch(error => setStatus({ state: 'failed', message: error.message })),
        )
      })

      yield* DshxPlugin.worker(
        settings.changes.pipe(
          Stream.map(TracesSettingsModel.listenConfigOf),
          Stream.changesWith(TracesSettingsModel.sameListenConfig),
          Stream.runForEach(config => Effect.andThen(FiberHandle.clear(server), FiberHandle.run(server, serve(config)))),
        ),
      )

      const status = Effect.gen(function* () {
        const listening = yield* SubscriptionRef.get(listenStatus)
        const counted = yield* Ref.get(counters)
        const message = listening.state === 'listening' ? yield* forwarder.listenMessage(listening.boundPort) : listening.message
        return {
          ...listening,
          message,
          requests: { ...counted.requests },
          accepted: { ...counted.accepted },
          rejectedRequests: counted.rejectedRequests,
          rejectedItems: counted.rejectedItems,
          lastReceivedAt: counted.lastReceivedAt,
          forward: yield* forwarder.status(listening.boundPort),
        } satisfies ReceiverSnapshot
      })

      return Receiver.of({ status, changes: SubscriptionRef.changes(listenStatus) })
    }),
  )
}
