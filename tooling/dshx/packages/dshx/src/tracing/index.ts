import { TracerModel, type Span, type SpanAttributes, type SpanContext, type StartSpanOptions } from './tracer.js'

export type { Span, SpanAttributes, SpanAttributeValue, SpanContext, SpanKind, SpanStatusCode, StartSpanOptions } from './tracer.js'

/** True when an OTLP endpoint is configured for this process; otherwise every span is a shared no-op. */
export const tracingEnabled = (): boolean => TracerModel.process().enabled

/** Start a span the caller must `end()`. Prefer `withSpan`, which also scopes it as the parent of nested spans. */
export const startSpan = (name: string, options?: StartSpanOptions): Span => TracerModel.process().startSpan(name, options)

/**
 * Run `run` inside a span: nested spans (in any plugin of this process) become its children, a throw marks it failed
 * with the error class only, and it ends when `run` settles. Record metadata only, never arguments or results.
 */
export const withSpan = <T>(name: string, options: StartSpanOptions, run: (span: Span) => Promise<T>): Promise<T> =>
  TracerModel.process().withSpan(name, options, run)

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
