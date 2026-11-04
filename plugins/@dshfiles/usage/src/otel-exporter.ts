import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Clock, Context, Duration, Effect, Layer, Option, Ref, Schedule, Schema } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import { DEFAULT_OTLP_SERVICE_NAME, type OtlpMetricsRequest } from './otel-metrics.js'
import { UsageRepo } from './store.js'

const DEFAULT_INTERVAL_MS = 60_000
const MIN_INTERVAL_MS = 1_000
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_BACKOFF_MS = 15 * 60_000

const otlpEnvironmentSchema = Schema.Struct({
  OTEL_SDK_DISABLED: Schema.optional(Schema.String),
  OTEL_METRICS_EXPORTER: Schema.optional(Schema.String),
  OTEL_SERVICE_NAME: Schema.optional(Schema.String),
  OTEL_EXPORTER_OTLP_ENDPOINT: Schema.optional(Schema.String),
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: Schema.optional(Schema.String),
  OTEL_EXPORTER_OTLP_HEADERS: Schema.optional(Schema.String),
  OTEL_EXPORTER_OTLP_METRICS_HEADERS: Schema.optional(Schema.String),
  OTEL_EXPORTER_OTLP_TIMEOUT: Schema.optional(Schema.String),
  OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: Schema.optional(Schema.String),
  OTEL_METRIC_EXPORT_INTERVAL: Schema.optional(Schema.String),
})

const positiveMillisecondsSchema = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0))
const nonnegativeMillisecondsSchema = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const decodeEnvironment = Schema.decodeUnknownOption(otlpEnvironmentSchema)
const decodeUrl = Schema.decodeUnknownOption(Schema.URLFromString)
const decodeMilliseconds = Schema.decodeUnknownOption(positiveMillisecondsSchema)

/** Every OTEL_* variable is an optional string, so a process environment always decodes; a blank value counts as unset. */
const environmentOf = (environment: Readonly<Record<string, string | undefined>>): typeof otlpEnvironmentSchema.Type => {
  const trimmed = Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, value?.trim() || undefined]))
  return Option.getOrElse(decodeEnvironment(trimmed), () => ({}))
}

const isHttpUrl = (value: string): boolean => Option.exists(decodeUrl(value), url => url.protocol === 'http:' || url.protocol === 'https:')

export interface OtlpExporterTiming {
  readonly intervalMs: number
  readonly timeoutMs: number
}

export interface OtlpExportDestination {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export interface OtlpExporterConfig extends OtlpExportDestination, OtlpExporterTiming {}

export type OtlpExporterResolution =
  | { readonly enabled: true; readonly config: OtlpExporterConfig }
  | { readonly enabled: false; readonly reason: 'not-configured' | 'disabled' | 'invalid-endpoint' }

const resolveServiceName = (environment: Readonly<Record<string, string | undefined>>): string =>
  environmentOf(environment).OTEL_SERVICE_NAME ?? DEFAULT_OTLP_SERVICE_NAME

const parseHeaders = (value: string | undefined) => {
  const headers: Record<string, string> = {}
  for (const entry of value?.split(',') ?? []) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    try {
      const key = decodeURIComponent(entry.slice(0, separator).trim())
      const headerValue = decodeURIComponent(entry.slice(separator + 1).trim())
      if (key !== '') headers[key.toLowerCase()] = headerValue
    } catch {
      continue
    }
  }
  return headers
}

const millisecondsOr = (value: string | undefined, fallback: number) => Option.getOrElse(decodeMilliseconds(value), () => fallback)

const timingOf = (environment: Readonly<Record<string, string | undefined>>): OtlpExporterTiming => {
  const env = environmentOf(environment)
  return {
    intervalMs: Math.max(MIN_INTERVAL_MS, millisecondsOr(env.OTEL_METRIC_EXPORT_INTERVAL, DEFAULT_INTERVAL_MS)),
    timeoutMs: millisecondsOr(env.OTEL_EXPORTER_OTLP_METRICS_TIMEOUT ?? env.OTEL_EXPORTER_OTLP_TIMEOUT, DEFAULT_TIMEOUT_MS),
  }
}

/**
 * An environment endpoint always wins. Without one, `localBaseUrl` (the Host's own receiver, published through
 * `@dshfiles/dshx/tracing`) is the target, without the environment's headers, which belong to a configured collector.
 */
const resolveExporter = (
  environment: Readonly<Record<string, string | undefined>>,
  options: { readonly localBaseUrl?: string | undefined } = {},
): OtlpExporterResolution => {
  const env = environmentOf(environment)
  if (env.OTEL_SDK_DISABLED?.toLowerCase() === 'true' || env.OTEL_METRICS_EXPORTER?.toLowerCase() === 'none') return { enabled: false, reason: 'disabled' }
  const configured =
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
    (env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined ? undefined : `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/u, '')}/v1/metrics`)
  if (configured === undefined) {
    const localUrl = options.localBaseUrl === undefined ? undefined : `${options.localBaseUrl.replace(/\/+$/u, '')}/v1/metrics`
    if (localUrl === undefined || !isHttpUrl(localUrl)) return { enabled: false, reason: 'not-configured' }
    return { enabled: true, config: { url: localUrl, headers: {}, ...timingOf(environment) } }
  }
  if (!isHttpUrl(configured)) return { enabled: false, reason: 'invalid-endpoint' }
  return {
    enabled: true,
    config: {
      url: configured,
      headers: { ...parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS), ...parseHeaders(env.OTEL_EXPORTER_OTLP_METRICS_HEADERS) },
      ...timingOf(environment),
    },
  }
}

export interface OtlpExporterState {
  readonly startedAt: number
  readonly exports: number
  readonly consecutiveFailures: number
  readonly lastError: string | null
  readonly lastSuccessAt: number | null
}

const decodeRetryAfterSeconds = Schema.decodeUnknownOption(nonnegativeMillisecondsSchema)

/** One export the collector refused or never answered; the exporter backs off and retries it. */
export class OtlpExportFailed extends Schema.TaggedError<OtlpExportFailed>()('OtlpExportFailed', {
  status: Schema.optional(Schema.Number),
  reason: Schema.String.check(Schema.isMaxLength(200)),
  retryAfterMs: Schema.Number,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.status === undefined ? this.reason : `HTTP ${String(this.status)}`
  }
}

const isEmpty = (request: OtlpMetricsRequest): boolean =>
  request.resourceMetrics.every(resource => resource.scopeMetrics.every(scope => scope.metrics.length === 0))

/**
 * Periodically POSTs cumulative OTLP/JSON metrics counted since the exporter started. It never fails: a refused or
 * unreachable collector is retried with exponential backoff (at least as long as a Retry-After asks), and the next
 * success resumes the configured interval. `destination` is read on every tick, so a receiver that binds after the
 * Host started is picked up; while it is None nothing is sent.
 */
export class OtlpExporter extends Context.Service<OtlpExporter, { readonly state: Effect.Effect<OtlpExporterState> }>()('@dshfiles/usage/OtlpExporter') {
  static readonly layer = (input: {
    readonly timing: OtlpExporterTiming
    readonly serviceName: string
    readonly destination: Effect.Effect<Option.Option<OtlpExportDestination>>
  }) =>
    Layer.effect(
      OtlpExporter,
      Effect.gen(function* () {
        const repo = yield* UsageRepo
        const client = yield* HttpClient.HttpClient
        const startedAt = yield* Clock.currentTimeMillis
        const state = yield* Ref.make<OtlpExporterState>({ startedAt, exports: 0, consecutiveFailures: 0, lastError: null, lastSuccessAt: null })
        const interval = Duration.millis(input.timing.intervalMs)
        const backoffCap = Duration.max(Duration.millis(MAX_BACKOFF_MS), interval)

        const post = Effect.fn('usage metrics export', { kind: 'client' })(function* (target: OtlpExportDestination, request: OtlpMetricsRequest) {
          yield* Effect.annotateCurrentSpan('server.address', new URL(target.url).host)
          const response = yield* client
            .execute(HttpClientRequest.post(target.url).pipe(HttpClientRequest.setHeaders(target.headers), HttpClientRequest.bodyJsonUnsafe(request)))
            .pipe(
              Effect.timeout(Duration.millis(input.timing.timeoutMs)),
              Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
              Effect.provideService(HttpClient.TracerPropagationEnabled, false),
              Effect.mapError(cause => new OtlpExportFailed({ reason: cause.message.slice(0, 200), retryAfterMs: 0, cause })),
            )
          yield* Effect.annotateCurrentSpan('http.response.status_code', response.status)
          yield* response.text.pipe(Effect.orElseSucceed(() => ''))
          if (response.status >= 200 && response.status < 300) return
          const retryAfterSeconds = Option.getOrElse(decodeRetryAfterSeconds(response.headers['retry-after']), () => 0)
          return yield* new OtlpExportFailed({ status: response.status, reason: `HTTP ${String(response.status)}`, retryAfterMs: retryAfterSeconds * 1_000 })
        })

        const exportOnce = Effect.gen(function* () {
          const target = yield* input.destination
          if (Option.isNone(target)) return
          const now = yield* Clock.currentTimeMillis
          const request = yield* repo
            .otelMetrics({ from: startedAt, to: Math.max(now, startedAt), temporality: 'cumulative', serviceName: input.serviceName })
            .pipe(Effect.mapError(cause => new OtlpExportFailed({ reason: cause.message, retryAfterMs: 0, cause })))
          if (isEmpty(request)) return
          yield* post(target.value, request)
          const succeededAt = yield* Clock.currentTimeMillis
          const previous = yield* Ref.getAndUpdate(state, current => ({
            ...current,
            exports: current.exports + 1,
            consecutiveFailures: 0,
            lastError: null,
            lastSuccessAt: succeededAt,
          }))
          if (previous.consecutiveFailures > 0) yield* Effect.logInfo('usage: OTLP metrics export recovered')
        })

        const recordFailure = (failure: OtlpExportFailed) =>
          Effect.gen(function* () {
            const updated = yield* Ref.updateAndGet(state, current => ({
              ...current,
              consecutiveFailures: current.consecutiveFailures + 1,
              lastError: failure.message,
            }))
            if (updated.consecutiveFailures === 1) yield* Effect.logWarning('usage: OTLP metrics export failed, backing off', failure.message)
          })

        const backoff = Schedule.exponential(Duration.times(interval, 2)).pipe(
          Schedule.setInputType<OtlpExportFailed>(),
          Schedule.modifyDelay(step => Effect.succeed(Duration.max(Duration.min(step.output, backoffCap), Duration.millis(step.input.retryAfterMs)))),
        )

        yield* Effect.sleep(interval).pipe(
          Effect.andThen(exportOnce.pipe(Effect.tapError(recordFailure), Effect.retry(backoff), Effect.repeat(Schedule.spaced(interval)))),
          DshxPlugin.detached,
          Effect.forkScoped,
        )
        return OtlpExporter.of({ state: Ref.get(state) })
      }),
    )
}

export class OtlpMetricsExporter {
  static readonly resolve = resolveExporter
  static readonly timing = timingOf
  static readonly serviceName = resolveServiceName
}
