import { Context, Duration, Effect, Layer, Schema, Stream } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { StatelessMcpModel, type JsonRecord, type ProbeOutcome } from './stateless-protocol.js'

const PROBE_TIMEOUT = Duration.seconds(10)
/** Tool results may carry images; anything past this is refused rather than buffered. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

/** One stateless request did not produce a complete result; `reason` is ours, never a raw server or credential string. */
export class StatelessRequestFailed extends Schema.TaggedError<StatelessRequestFailed>()('StatelessRequestFailed', {
  method: Schema.String,
  reason: Schema.String,
  code: Schema.optional(Schema.Number),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `MCP ${this.method} failed: ${this.reason}`
  }
}

/** The endpoint and static headers (static per attach: a refreshed OAuth token re-attaches the server). */
export interface StatelessEndpoint {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

interface RawAnswer {
  readonly status: number
  /** The JSON-RPC message answering the request, or the bare JSON object body; undefined when there was none. */
  readonly message: JsonRecord | undefined
}

/**
 * MCP `2026-07-28` over Streamable HTTP: every request is its own POST carrying its protocol version, client info and
 * capabilities in `params._meta`, mirrored into headers. There is no session, no `initialize` and no GET stream.
 */
export class StatelessMcp extends Context.Service<
  StatelessMcp,
  {
    /** Ask `server/discover` which era the server speaks; never fails, a transport error means "legacy". */
    readonly probe: (endpoint: StatelessEndpoint) => Effect.Effect<ProbeOutcome>
    readonly request: (input: {
      readonly endpoint: StatelessEndpoint
      readonly method: string
      readonly params: JsonRecord
      readonly extraHeaders?: Readonly<Record<string, string>>
      readonly timeout: Duration.Input
    }) => Effect.Effect<JsonRecord, StatelessRequestFailed>
  }
>()('@dshfiles/mcp-servers/StatelessMcp') {
  static readonly layer = Layer.effect(
    StatelessMcp,
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient
      // JSON-RPC ids only pair a request with its own answer; one counter per layer is enough.
      let nextId = 1

      /** POST one request and read its JSON or SSE answer up to the response for its id. */
      const exchange = (input: {
        readonly endpoint: StatelessEndpoint
        readonly method: string
        readonly params: JsonRecord
        readonly extraHeaders?: Readonly<Record<string, string>> | undefined
        readonly timeout: Duration.Input
      }) =>
        Effect.gen(function* () {
          const id = nextId++
          const wire = StatelessMcpModel.request({
            id,
            method: input.method,
            params: input.params,
            extraHeaders: { ...input.endpoint.headers, ...input.extraHeaders },
          })
          const response = yield* client.execute(
            HttpClientRequest.post(input.endpoint.url).pipe(
              HttpClientRequest.setHeaders(wire.headers),
              HttpClientRequest.bodyText(wire.body, 'application/json'),
            ),
          )
          yield* Effect.annotateCurrentSpan({ 'http.response.status_code': response.status })
          const type = (response.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase()
          let size = 0
          const bounded = response.stream.pipe(
            Stream.mapEffect(chunk => {
              size += chunk.length
              return size > MAX_RESPONSE_BYTES
                ? Effect.fail(new StatelessRequestFailed({ method: input.method, reason: 'the response is too large' }))
                : Effect.succeed(chunk)
            }),
            Stream.decodeText(),
          )
          if (type === 'text/event-stream') {
            const decode = StatelessMcpModel.sseDecoder()
            let message: JsonRecord | undefined
            yield* Stream.runForEachWhile(bounded, text =>
              Effect.sync(() => {
                for (const data of decode(text)) {
                  const parsed = StatelessMcpModel.parseJsonObject(data)
                  if (parsed === undefined) continue
                  // Request-scoped notifications (progress, logging) precede the final response; they are not surfaced.
                  const answer = StatelessMcpModel.responseFor(id, parsed)
                  if (answer !== undefined) message = answer
                }
                return message === undefined
              }),
            )
            return { status: response.status, message } satisfies RawAnswer
          }
          const text = yield* Stream.mkString(bounded)
          const message = text.length === 0 ? undefined : StatelessMcpModel.parseJsonObject(text)
          return { status: response.status, message } satisfies RawAnswer
        }).pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: 'error' }),
          Effect.timeoutOrElse({
            duration: input.timeout,
            orElse: () => Effect.fail(new StatelessRequestFailed({ method: input.method, reason: 'the request timed out' })),
          }),
          Effect.mapError(cause =>
            cause instanceof StatelessRequestFailed
              ? cause
              : new StatelessRequestFailed({ method: input.method, reason: 'the request could not be sent', cause }),
          ),
        )

      const probe = Effect.fn('mcp stateless probe')(function* (endpoint: StatelessEndpoint) {
        yield* Effect.annotateCurrentSpan({ 'server.address': safeHost(endpoint.url) })
        const outcome = yield* exchange({ endpoint, method: 'server/discover', params: {}, timeout: PROBE_TIMEOUT }).pipe(
          Effect.map(answer => StatelessMcpModel.classifyProbe(answer.status, answer.message)),
          Effect.catch(error => Effect.succeed<ProbeOutcome>({ kind: 'legacy', reason: error.reason })),
        )
        yield* Effect.annotateCurrentSpan({ 'dshx.mcp-servers.protocol_era': outcome.kind })
        return outcome
      })

      const request = Effect.fn('mcp stateless request')(function* (input: {
        readonly endpoint: StatelessEndpoint
        readonly method: string
        readonly params: JsonRecord
        readonly extraHeaders?: Readonly<Record<string, string>>
        readonly timeout: Duration.Input
      }) {
        yield* Effect.annotateCurrentSpan({ 'server.address': safeHost(input.endpoint.url), 'rpc.method': input.method })
        const answer = yield* exchange(input)
        const error = StatelessMcpModel.jsonRpcError(answer.message)
        if (error !== undefined)
          return yield* new StatelessRequestFailed({
            method: input.method,
            reason: `the server answered JSON-RPC error ${error.code}${error.message ? `: ${error.message}` : ''}`,
            code: error.code,
          })
        if (answer.status < 200 || answer.status >= 300)
          return yield* new StatelessRequestFailed({ method: input.method, reason: `the server answered HTTP ${answer.status}` })
        const message = answer.message
        if (message === undefined || !('result' in message))
          return yield* new StatelessRequestFailed({ method: input.method, reason: 'the server sent no JSON-RPC result' })
        const complete = StatelessMcpModel.completeResult(message['result'])
        if (!complete.ok) return yield* new StatelessRequestFailed({ method: input.method, reason: complete.reason })
        return complete.result
      })

      return StatelessMcp.of({ probe, request })
    }),
  )
}

const safeHost = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return 'invalid'
  }
}
