/**
 * The wire between the browser tracer and the Host API that forwards its spans (`browser-ingest.ts`). Runtime-neutral:
 * the browser half imports only this file's constants and types, so no schema library lands in Client bundles.
 */

export type BrowserAttributeValue = string | number | boolean

export type BrowserSpanKind = 'internal' | 'client'

export type BrowserStatusCode = 'unset' | 'ok' | 'error'

export interface BrowserSpanEventRecord {
  readonly name: string
  readonly timeMs: number
  readonly attributes: Readonly<Record<string, BrowserAttributeValue>>
}

/** One ended browser span. Times are Unix epoch milliseconds (fractional). */
export interface BrowserSpanRecord {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string | undefined
  readonly name: string
  readonly kind: BrowserSpanKind
  readonly startTimeMs: number
  readonly endTimeMs: number
  readonly attributes: Readonly<Record<string, BrowserAttributeValue>>
  readonly status: { readonly code: BrowserStatusCode; readonly message?: string | undefined }
  readonly events: readonly BrowserSpanEventRecord[]
}

export type BrowserEngine = 'chromium' | 'firefox' | 'webkit' | 'other'

/** The only facts about the page that leave it: an engine class and a mobile flag, never the user agent string. */
export interface BrowserResource {
  readonly engine: BrowserEngine
  readonly mobile: boolean
}

export interface BrowserTracingStatus {
  /** False while the Host has nowhere to send traces (no OTLP endpoint and no in-process receiver). */
  readonly enabled: boolean
  /** Share of root spans kept, 0..1. */
  readonly sampleRatio: number
  /** Root spans (interactions) one page may start per minute. */
  readonly maxRootSpansPerMinute: number
}

export interface BrowserTracesExportResult {
  readonly accepted: number
  readonly dropped: number
}

export const BROWSER_TRACES_LIMITS = {
  spansPerExport: 128,
  attributesPerSpan: 32,
  eventsPerSpan: 32,
  attributesPerEvent: 8,
  nameLength: 128,
  stringLength: 256,
  statusMessageLength: 128,
  /** A browser span longer than this is a stuck interaction, not a measurement. */
  spanDurationMs: 10 * 60_000,
  /** Accepted distance between a span's clock and the Host's, both ways. */
  clockSkewMs: 60 * 60_000,
  /** Spans one Host process forwards per minute from every page together. */
  hostSpansPerMinute: 1_200,
} as const

export const BROWSER_TRACES_API = {
  owner: '@dshfiles/dshx',
  id: 'browser-traces',
  version: 1,
} as const

/** `service.name` of every forwarded browser span. */
export const BROWSER_SERVICE_NAME = 'dshfiles-web'
