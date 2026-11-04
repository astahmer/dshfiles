import type { IncomingHttpHeaders } from 'node:http'
import { Context, Duration, Effect, FiberSet, Layer, Option, Ref, Schema, Semaphore } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import type { OtlpSignal } from './otlp/decode.js'
import { ForwardFailed } from './receiver-errors.js'
import { TracesSettingsModel, TracesSettingsService } from './settings.js'

const FORWARD_TIMEOUT = Duration.seconds(5)
const MAX_FORWARDS_IN_FLIGHT = 8
const INVALID_FORWARD_URL = 'The forward URL must be an http(s) URL.'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

const forwardUrlSchema = Schema.String.check(
  Schema.makeFilter(value => {
    if (!URL.canParse(value)) return INVALID_FORWARD_URL
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:' ? true : INVALID_FORWARD_URL
  }),
)
const decodeForwardUrl = Schema.decodeUnknownOption(forwardUrlSchema)

/** A base URL like `http://127.0.0.1:4319`; `/v1/traces` and `/v1/metrics` are appended. Empty turns forwarding off. */
export type ForwardTarget = { readonly url: URL | null; readonly error: string | null }

export const parseForwardUrl = (text: string): ForwardTarget => {
  const trimmed = text.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return { url: null, error: null }
  return Option.match(decodeForwardUrl(trimmed), {
    onNone: () => ({ url: null, error: INVALID_FORWARD_URL }),
    onSome: valid => ({ url: new URL(valid), error: null }),
  })
}

export const pointsAt = (url: URL, port: number): boolean => {
  const urlPort = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port)
  return LOOPBACK_HOSTS.has(url.hostname) && urlPort === port
}

const targetOf = (forwardUrl: string, boundPort: number | null): URL | null => {
  const parsed = parseForwardUrl(forwardUrl)
  if (parsed.url === null || (boundPort !== null && pointsAt(parsed.url, boundPort))) return null
  return parsed.url
}

export type ForwardStatus = { readonly url: string | null; readonly forwarded: number; readonly failures: number; readonly lastError: string | null }

type Counters = { readonly forwarded: number; readonly failures: number; readonly lastError: string | null }

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 300)

/** Both mode: every accepted OTLP body goes on, unchanged, to the external viewer, at most 8 at a time. */
export class Forwarder extends Context.Service<
  Forwarder,
  {
    readonly forward: (input: {
      readonly signal: OtlpSignal
      readonly body: Buffer
      readonly headers: IncomingHttpHeaders
      readonly boundPort: number | null
    }) => Effect.Effect<void>
    readonly status: (boundPort: number | null) => Effect.Effect<ForwardStatus>
    /** The listener's status message about the forward URL: invalid, or pointing back at this receiver. */
    readonly listenMessage: (boundPort: number | null) => Effect.Effect<string | null>
  }
>()('@dshfiles/traces/Forwarder') {
  static readonly layer = Layer.effect(
    Forwarder,
    Effect.gen(function* () {
      const settings = yield* TracesSettingsService
      const client = yield* HttpClient.HttpClient
      const permits = yield* Semaphore.make(MAX_FORWARDS_IN_FLIGHT)
      const inFlight = yield* FiberSet.make()
      const counters = yield* Ref.make<Counters>({ forwarded: 0, failures: 0, lastError: null })
      const fail = (lastError: string) => Ref.update(counters, current => ({ ...current, failures: current.failures + 1, lastError }))
      const forwardUrl = Effect.map(settings.get, TracesSettingsModel.forwardUrlOf)

      const send = Effect.fnUntraced(function* (input: {
        readonly target: URL
        readonly signal: OtlpSignal
        readonly body: Buffer
        readonly headers: IncomingHttpHeaders
      }) {
        const url = new URL(`${input.target.pathname.replace(/\/+$/, '')}/v1/${input.signal}`, input.target)
        const encoding = input.headers['content-encoding']
        const request = HttpClientRequest.post(url).pipe(
          HttpClientRequest.bodyUint8Array(new Uint8Array(input.body), input.headers['content-type'] ?? 'application/json'),
          HttpClientRequest.setHeaders(encoding === undefined ? {} : { 'content-encoding': encoding }),
        )
        const response = yield* client.execute(request).pipe(
          Effect.timeout(FORWARD_TIMEOUT),
          Effect.mapError(cause => new ForwardFailed({ target: input.target.origin, reason: describe(cause), cause })),
        )
        yield* Effect.ignore(response.arrayBuffer)
        if (response.status < 200 || response.status >= 300)
          return yield* new ForwardFailed({
            target: input.target.origin,
            status: response.status,
            reason: `HTTP ${String(response.status)} from ${input.target.origin}`,
          })
      })

      const forward = Effect.fn('otlp forward')(function* (input: {
        readonly signal: OtlpSignal
        readonly body: Buffer
        readonly headers: IncomingHttpHeaders
        readonly boundPort: number | null
      }) {
        const target = targetOf(yield* forwardUrl, input.boundPort)
        if (target === null) return
        yield* FiberSet.run(
          inFlight,
          send({ target, signal: input.signal, body: input.body, headers: input.headers }).pipe(
            permits.withPermitsIfAvailable(1),
            Effect.flatMap(sent =>
              Option.isNone(sent)
                ? fail('Dropped: too many forwards in flight.')
                : Ref.update(counters, current => ({ ...current, forwarded: current.forwarded + 1 })),
            ),
            Effect.catchTag('ForwardFailed', error => fail(error.message)),
            Effect.withTracerEnabled(false),
          ),
        )
      })

      const status = Effect.fn('otlp forward status')(function* (boundPort: number | null) {
        const current = yield* Ref.get(counters)
        return {
          url: targetOf(yield* forwardUrl, boundPort)?.toString() ?? null,
          forwarded: current.forwarded,
          failures: current.failures,
          lastError: current.lastError,
        } satisfies ForwardStatus
      })

      const listenMessage = Effect.fn('otlp forward listen message')(function* (boundPort: number | null) {
        const configured = yield* forwardUrl
        const error = parseForwardUrl(configured).error
        if (error !== null) return error
        const loops = configured.trim() !== '' && targetOf(configured, boundPort) === null
        return loops ? 'The forward URL points at this receiver; forwarding is off.' : null
      })

      return Forwarder.of({ forward, status, listenMessage })
    }),
  )
}
