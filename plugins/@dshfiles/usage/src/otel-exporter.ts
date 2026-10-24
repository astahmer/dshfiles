import { z } from 'zod'
import { DEFAULT_OTLP_SERVICE_NAME, type OtlpMetricsRequest } from './otel-metrics.js'
import { withSpan } from '@dshfiles/dshx/tracing'

const DEFAULT_INTERVAL_MS = 60_000
const MIN_INTERVAL_MS = 1_000
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_BACKOFF_MS = 15 * 60_000
const MAX_BACKOFF_EXPONENT = 10

const optionalText = z
  .string()
  .optional()
  .transform(value => {
    const trimmed = value?.trim()
    return trimmed === undefined || trimmed === '' ? undefined : trimmed
  })

const otlpEnvironmentSchema = z.object({
  OTEL_SDK_DISABLED: optionalText,
  OTEL_METRICS_EXPORTER: optionalText,
  OTEL_SERVICE_NAME: optionalText,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalText,
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: optionalText,
  OTEL_EXPORTER_OTLP_HEADERS: optionalText,
  OTEL_EXPORTER_OTLP_METRICS_HEADERS: optionalText,
  OTEL_EXPORTER_OTLP_TIMEOUT: optionalText,
  OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: optionalText,
  OTEL_METRIC_EXPORT_INTERVAL: optionalText,
})

const httpUrlSchema = z.url({ protocol: /^https?$/u })

const positiveMillisecondsSchema = z.coerce.number().int().positive()

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
  otlpEnvironmentSchema.parse(environment).OTEL_SERVICE_NAME ?? DEFAULT_OTLP_SERVICE_NAME

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

const millisecondsOr = (value: string | undefined, fallback: number) => {
  const parsed = positiveMillisecondsSchema.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

const timingOf = (environment: Readonly<Record<string, string | undefined>>): OtlpExporterTiming => {
  const env = otlpEnvironmentSchema.parse(environment)
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
  const env = otlpEnvironmentSchema.parse(environment)
  if (env.OTEL_SDK_DISABLED?.toLowerCase() === 'true' || env.OTEL_METRICS_EXPORTER?.toLowerCase() === 'none') return { enabled: false, reason: 'disabled' }
  const configured =
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
    (env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined ? undefined : `${env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/u, '')}/v1/metrics`)
  if (configured === undefined) {
    const localUrl = options.localBaseUrl === undefined ? undefined : `${options.localBaseUrl.replace(/\/+$/u, '')}/v1/metrics`
    if (localUrl === undefined || !httpUrlSchema.safeParse(localUrl).success) return { enabled: false, reason: 'not-configured' }
    return { enabled: true, config: { url: localUrl, headers: {}, ...timingOf(environment) } }
  }
  if (!httpUrlSchema.safeParse(configured).success) return { enabled: false, reason: 'invalid-endpoint' }
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
  readonly nextDelayMs: number
  readonly lastError: string | null
  readonly lastSuccessAt: number | null
}

const retryAfterMsOf = (response: Response) => {
  const seconds = z.coerce
    .number()
    .int()
    .nonnegative()
    .safeParse(response.headers.get('retry-after') ?? undefined)
  return seconds.success ? seconds.data * 1_000 : 0
}

const failureMessageOf = (error: unknown): string => {
  if (!(error instanceof Error)) return 'export failed'
  const cause = z.object({ code: z.string().max(64) }).safeParse(error.cause)
  return (cause.success ? `${error.message} (${cause.data.code})` : error.message).slice(0, 200)
}

/**
 * Periodically POSTs cumulative OTLP/JSON metrics counted since the exporter started. It never throws: failures back off
 * exponentially (honouring Retry-After) and the next success resumes the configured interval. `destination` is read on
 * every tick, so a receiver that binds after the Host started is picked up; while it is undefined nothing is sent.
 */
const startExporter = (input: {
  readonly timing: OtlpExporterTiming
  readonly destination: () => OtlpExportDestination | undefined
  readonly collect: (range: { readonly from: number; readonly to: number }) => OtlpMetricsRequest
  readonly onFailure?: (failure: { readonly message: string; readonly consecutiveFailures: number }) => void
  readonly onRecovery?: () => void
}) => {
  const startedAt = Date.now()
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | null = null
  let stopped = false
  let exports = 0
  let consecutiveFailures = 0
  let retryAfterMs = 0
  let lastError: string | null = null
  let lastSuccessAt: number | null = null

  const nextDelayMs = () => {
    if (consecutiveFailures === 0) return input.timing.intervalMs
    const backoff = Math.min(
      input.timing.intervalMs * 2 ** Math.min(consecutiveFailures, MAX_BACKOFF_EXPONENT),
      Math.max(MAX_BACKOFF_MS, input.timing.intervalMs),
    )
    return Math.max(backoff, retryAfterMs)
  }

  const notify = (callback: () => void) => {
    try {
      callback()
    } catch {
      return
    }
  }

  const fail = (message: string, retryAfter: number) => {
    consecutiveFailures += 1
    retryAfterMs = retryAfter
    lastError = message
    notify(() => input.onFailure?.({ message, consecutiveFailures }))
  }

  const exportOnce = async () => {
    try {
      const destination = input.destination()
      if (destination === undefined) return
      const request = input.collect({ from: startedAt, to: Math.max(Date.now(), startedAt) })
      if (request.resourceMetrics.every(resource => resource.scopeMetrics.every(scope => scope.metrics.length === 0))) return
      const response = await withSpan(
        'usage metrics export',
        { kind: 'client', attributes: { 'server.address': new URL(destination.url).host } },
        async span => {
          const sent = await fetch(destination.url, {
            method: 'POST',
            headers: { ...destination.headers, 'content-type': 'application/json' },
            body: JSON.stringify(request),
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(input.timing.timeoutMs)]),
          })
          span.setAttribute('http.response.status_code', sent.status)
          return sent
        },
      )
      await response.arrayBuffer().catch(() => undefined)
      if (!response.ok) {
        fail(`HTTP ${String(response.status)}`, retryAfterMsOf(response))
        return
      }
      exports += 1
      lastSuccessAt = Date.now()
      if (consecutiveFailures > 0) notify(() => input.onRecovery?.())
      consecutiveFailures = 0
      retryAfterMs = 0
      lastError = null
    } catch (error) {
      if (stopped) return
      fail(failureMessageOf(error), 0)
    }
  }

  const schedule = () => {
    if (stopped) return
    timer = setTimeout(() => {
      inFlight = exportOnce().finally(() => {
        inFlight = null
        schedule()
      })
    }, nextDelayMs())
    timer.unref?.()
  }
  schedule()

  return {
    state: (): OtlpExporterState => ({ startedAt, exports, consecutiveFailures, nextDelayMs: nextDelayMs(), lastError, lastSuccessAt }),
    stop: async () => {
      stopped = true
      clearTimeout(timer)
      abort.abort()
      await inFlight
    },
  }
}

export class OtlpMetricsExporter {
  static readonly resolve = resolveExporter
  static readonly timing = timingOf
  static readonly serviceName = resolveServiceName
  static readonly start = startExporter
}
