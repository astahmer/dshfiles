/**
 * An in-process OTLP receiver (the traces plugin's) announces its bound base URL here, so the exporters of the same
 * Host process (dshx tracing, the usage metrics push) can deliver to it when no `OTEL_EXPORTER_OTLP_*` endpoint is
 * set. Every plugin bundles its own dshx copy, so the value lives on `globalThis` under a versioned symbol.
 */

export interface LocalOtlpEndpoint {
  /** OTLP/HTTP base URL, e.g. `http://127.0.0.1:4318`; exporters append `/v1/<signal>`. */
  readonly baseUrl: string
  /** Package that published it, for diagnostics. */
  readonly owner: string
}

const LOCAL_ENDPOINT_KEY = Symbol.for('@dshfiles/dshx.otlp-local-endpoint.v1')

// SAFETY: only this module writes the versioned symbol, and always a frozen LocalOtlpEndpoint.
const holder = globalThis as { [LOCAL_ENDPOINT_KEY]?: LocalOtlpEndpoint }

const normalizedBaseUrl = (raw: string): string | undefined => {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`
  } catch {
    return undefined
  }
}

/**
 * Publish this process's own OTLP receiver. Returns a withdraw function that only removes this publication, so a
 * newer one (a reloaded plugin) is never cleared by a stale owner. An invalid URL publishes nothing.
 */
const publish = (endpoint: LocalOtlpEndpoint): (() => void) => {
  const baseUrl = normalizedBaseUrl(endpoint.baseUrl)
  if (baseUrl === undefined) return () => undefined
  const published: LocalOtlpEndpoint = Object.freeze({ baseUrl, owner: endpoint.owner })
  holder[LOCAL_ENDPOINT_KEY] = published
  return () => {
    if (holder[LOCAL_ENDPOINT_KEY] === published) delete holder[LOCAL_ENDPOINT_KEY]
  }
}

const current = (): LocalOtlpEndpoint | undefined => holder[LOCAL_ENDPOINT_KEY]

export type OtlpSignal = 'traces' | 'metrics' | 'logs'

export interface OtlpExportTarget {
  /** `environment`: an `OTEL_EXPORTER_OTLP_*` endpoint (always wins); `local-receiver`: the published receiver. */
  readonly source: 'environment' | 'local-receiver' | 'off'
  /** Full signal URL (`…/v1/<signal>`), or null when `off`. */
  readonly url: string | null
}

type Environment = Readonly<Record<string, string | undefined>>

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Where one signal goes now, by the OpenTelemetry specification's rules plus the in-process fallback:
 * `OTEL_SDK_DISABLED=true` or `OTEL_<SIGNAL>_EXPORTER=none` is off; `OTEL_EXPORTER_OTLP_<SIGNAL>_ENDPOINT` is used as
 * given; `OTEL_EXPORTER_OTLP_ENDPOINT` gets `/v1/<signal>`; an environment endpoint that is not http(s) is off, never
 * replaced; without any, the published local receiver. Cheap: call it at export time, not once at load.
 */
const exportTarget = (input: { readonly signal: OtlpSignal; readonly env?: Environment }): OtlpExportTarget => {
  const env = input.env ?? process.env
  const off: OtlpExportTarget = { source: 'off', url: null }
  if (nonEmpty(env.OTEL_SDK_DISABLED)?.toLowerCase() === 'true') return off
  if (nonEmpty(env[`OTEL_${input.signal.toUpperCase()}_EXPORTER`])?.toLowerCase() === 'none') return off
  const signalEndpoint = nonEmpty(env[`OTEL_EXPORTER_OTLP_${input.signal.toUpperCase()}_ENDPOINT`])
  const baseEndpoint = nonEmpty(env.OTEL_EXPORTER_OTLP_ENDPOINT)
  const configured = signalEndpoint ?? (baseEndpoint === undefined ? undefined : `${baseEndpoint.replace(/\/+$/u, '')}/v1/${input.signal}`)
  if (configured !== undefined) {
    const url = normalizedBaseUrl(configured)
    return url === undefined ? off : { source: 'environment', url: configured }
  }
  const local = current()
  return local === undefined ? off : { source: 'local-receiver', url: `${local.baseUrl}/v1/${input.signal}` }
}

export class LocalOtlpEndpointRegistry {
  static readonly publish = publish
  static readonly current = current
  static readonly exportTarget = exportTarget
}
