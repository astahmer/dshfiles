import { TracingHelpers } from './helpers.js'
import { LocalOtlpEndpointRegistry, type LocalOtlpEndpoint, type OtlpExportTarget, type OtlpSignal } from './local-endpoint.js'
import { TracerModel, type Span, type SpanAttributes, type SpanContext, type StartSpanOptions } from './tracer.js'

export type { LocalOtlpEndpoint, OtlpExportTarget, OtlpSignal } from './local-endpoint.js'
export type { Span, SpanAttributes, SpanContext, StartSpanOptions } from './tracer.js'
export type { SpanAttributeValue, SpanKind, SpanStatusCode } from './otlp-exporter.js'
export type { RecordedSpan, SpanRecorder } from './recorder.js'

export const withActiveSpan = TracingHelpers.withActiveSpan
export const traced = TracingHelpers.traced
export const recordSpans = TracingHelpers.recordSpans
export const pluginAttributes = TracingHelpers.pluginAttributes
export const redactIdentifier = TracingHelpers.redactIdentifier
export const contentSize = TracingHelpers.contentSize
export const truncateText = TracingHelpers.truncateText

/**
 * True when spans are recorded now: an OTLP endpoint is configured for this process, or (without one) an in-process
 * receiver is published. Otherwise every span is a shared no-op. It can turn true after the first span.
 */
export const tracingEnabled = (): boolean => TracerModel.process().enabled

/**
 * Announce this Host process's own OTLP/HTTP receiver (e.g. `http://127.0.0.1:4318`). While no `OTEL_EXPORTER_OTLP_*`
 * endpoint is set, dshx spans and every exporter that reads `localOtlpEndpoint()` deliver there. Returns a withdraw
 * function that only removes this publication. Host only; one receiver per process (the latest publication wins).
 */
export const publishLocalOtlpEndpoint = (endpoint: LocalOtlpEndpoint): (() => void) => LocalOtlpEndpointRegistry.publish(endpoint)

/** The published in-process receiver. Read it at export time: it can appear, move or vanish while the Host runs. */
export const localOtlpEndpoint = (): LocalOtlpEndpoint | undefined => LocalOtlpEndpointRegistry.current()

/**
 * Where one OTLP signal from this process goes now: `environment` (an `OTEL_EXPORTER_OTLP_*` endpoint, which always
 * wins; `OTEL_SDK_DISABLED=true` or `OTEL_<SIGNAL>_EXPORTER=none` turn it off), else `local-receiver` (the published
 * receiver), else `off`. Exporters call it per export so a receiver that binds later is picked up.
 */
export const otlpExportTarget = (input: { readonly signal: OtlpSignal }): OtlpExportTarget => LocalOtlpEndpointRegistry.exportTarget(input)

/** Start a span the caller must `end()`. Prefer `withSpan`, which also scopes it as the parent of nested spans. */
export const startSpan = (name: string, options?: StartSpanOptions): Span => TracerModel.process().startSpan(name, options)

interface WithSpan {
  <T>(name: string, run: (span: Span) => Promise<T>): Promise<T>
  <T>(name: string, options: StartSpanOptions, run: (span: Span) => Promise<T>): Promise<T>
}

/**
 * Run `run` inside a span: nested spans (in any plugin of this process) become its children, a throw marks it failed
 * with the error class only, and it ends when `run` settles. Record metadata only, never arguments or results.
 * `options` (kind, attributes, an explicit parent) may be omitted.
 */
export const withSpan: WithSpan = <T>(
  name: string,
  optionsOrRun: StartSpanOptions | ((span: Span) => Promise<T>),
  run?: (span: Span) => Promise<T>,
): Promise<T> => {
  if (typeof optionsOrRun === 'function') return TracerModel.process().withSpan(name, {}, optionsOrRun)
  if (run === undefined) return Promise.reject(new TypeError('withSpan needs a callback'))
  return TracerModel.process().withSpan(name, optionsOrRun, run)
}

export const activeSpanContext = (): SpanContext | undefined => TracerModel.process().activeContext()

/** The W3C `traceparent` header value for the active span, to continue its trace in another process. */
export const traceparent = (): string | undefined => TracerModel.process().traceparent()

export const parseTraceparent = (header: string | null | undefined): SpanContext | undefined => TracerModel.parseTraceparent(header)

/** Send every queued span now; resolves (never rejects) once each batch was tried once. */
export const flushTracing = (): Promise<void> => TracerModel.process().flush()

const SUBCOMMAND = /^[a-z][a-z0-9-]{0,31}$/u
const MAX_FLAGS = 32

/**
 * Bounded, value-free attributes for one subprocess: the executable name, up to two adjacent leading subcommand
 * words (`workspace list`), and flag names without their values. Positional arguments (paths, revisions, messages)
 * and flag values are never recorded; `valueFlags` names the flags whose next argument is such a value.
 */
export const commandAttributes = (input: {
  readonly executable: string
  readonly args: readonly string[]
  readonly valueFlags?: readonly string[]
}): SpanAttributes => {
  const verbs: string[] = []
  const flags = new Set<string>()
  let verbPhase = true
  for (let index = 0; index < input.args.length; index += 1) {
    const arg = input.args[index] ?? ''
    if (arg.startsWith('-')) {
      const flag = arg.startsWith('--') ? (arg.split('=', 1)[0] ?? arg) : arg.slice(0, 2)
      if (flags.size < MAX_FLAGS) flags.add(flag.slice(0, 64))
      if (flag === arg && input.valueFlags?.includes(flag) === true) index += 1
      if (verbs.length > 0) verbPhase = false
      continue
    }
    if (verbPhase && verbs.length < 2 && SUBCOMMAND.test(arg)) verbs.push(arg)
    else verbPhase = false
  }
  return {
    'process.executable.name': input.executable.split(/[\\/]/u).pop() ?? input.executable,
    'process.command.verb': verbs.join(' '),
    'process.command.flags': [...flags],
    'process.command.arg_count': input.args.length,
  }
}
