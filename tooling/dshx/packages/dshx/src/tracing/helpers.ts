import { redactIdentifier } from './identifier.js'
import { SpanRecorders, type SpanRecorder } from './recorder.js'
import type { SpanAttributeValue } from './otlp-exporter.js'
import { TracerModel, type Span, type SpanContext, type StartSpanOptions } from './tracer.js'

/**
 * Run `run` with an existing span as the active parent: every span opened inside it, in any plugin of this process
 * (dshx API dispatches, jj or secret runs, Jev calls), becomes that span's child. The span's lifetime stays the
 * caller's; use it for a span whose start and end are events rather than one callback (an agent tool call).
 */
const withActiveSpan = <T>(span: Span | SpanContext | undefined, run: () => T): T => {
  const context = span === undefined ? undefined : 'recording' in span ? span.context : span
  return TracerModel.process().runWithParent(context, run)
}

type SpanOptionsFor<Args extends readonly unknown[]> = StartSpanOptions | ((...args: Args) => StartSpanOptions)

/**
 * Wrap an async function so every call runs inside a span named `name`. `options` may be computed from the call's
 * arguments; keep it to identities, counts and sizes, never the arguments themselves.
 */
const traced =
  <Args extends readonly unknown[], Result>(
    name: string,
    run: (...args: Args) => Promise<Result>,
    options: SpanOptionsFor<Args> = {},
  ): ((...args: Args) => Promise<Result>) =>
  (...args) =>
    TracerModel.process().withSpan(name, typeof options === 'function' ? options(...args) : options, () => run(...args))

/**
 * Record every span ended in this process from now until `stop()` (or the end of a `using` block), whether or not an
 * OTLP endpoint is configured. The test kit for plugins:
 *
 * ```ts
 * using recorder = recordSpans()
 * await triage(item)
 * expect(recorder.span('backlog triage').attributes['dshx.backlog.items']).toBe(1)
 * ```
 */
const recordSpans = (): SpanRecorder => SpanRecorders.record()

const ATTRIBUTE_SEGMENT = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u
const PLUGIN_SEGMENT = /^[a-z][a-z0-9-]*$/u

type PluginAttributes<Plugin extends string, Attributes> = {
  readonly [Key in keyof Attributes & string as `dshx.${Plugin}.${Key}`]: Attributes[Key]
}

/**
 * Name a plugin's own attributes by the convention `dshx.<plugin>.<key>` (`pluginAttributes({ plugin: 'backlog',
 * attributes: { items: 3 } })` → `{ 'dshx.backlog.items': 3 }`). Keys are lowercase `snake_case` segments joined by
 * dots; a malformed plugin name or key throws, so a typo fails its test instead of exporting a stray name. Use the
 * standard keys (`gen_ai.*`, `process.*`, `rpc.*`, `error.type`) directly when one applies.
 */
const pluginAttributes = <Plugin extends string, Attributes extends Readonly<Record<string, SpanAttributeValue | undefined>>>(input: {
  readonly plugin: Plugin
  readonly attributes: Attributes
}): PluginAttributes<Plugin, Attributes> => {
  if (!PLUGIN_SEGMENT.test(input.plugin)) throw new TypeError(`span attribute plugin ${JSON.stringify(input.plugin)} is not kebab-case`)
  const entries = Object.entries(input.attributes).map(([key, value]) => {
    if (!ATTRIBUTE_SEGMENT.test(key)) throw new TypeError(`span attribute key ${JSON.stringify(key)} is not lowercase snake_case`)
    return [`dshx.${input.plugin}.${key}`, value] as const
  })
  // SAFETY: the keys were built from `Attributes` with exactly the mapped type's template.
  return Object.fromEntries(entries) as PluginAttributes<Plugin, Attributes>
}

/** The size of a payload instead of the payload: string length, list length, or the JSON length of anything else. */
const contentSize = (value: unknown): number => {
  if (typeof value === 'string' || Array.isArray(value)) return value.length
  if (value === undefined) return 0
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

/** Cut text the caller deliberately records (a status label, an opted-in message) to `maxLength`, marking the cut. */
const truncateText = (input: { readonly text: string; readonly maxLength: number }): string =>
  input.text.length <= input.maxLength ? input.text : `${input.text.slice(0, Math.max(0, input.maxLength - 1))}…`

export class TracingHelpers {
  static readonly withActiveSpan = withActiveSpan
  static readonly traced = traced
  static readonly recordSpans = recordSpans
  static readonly pluginAttributes = pluginAttributes
  static readonly redactIdentifier = redactIdentifier
  static readonly contentSize = contentSize
  static readonly truncateText = truncateText
}
