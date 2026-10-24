import {
  BrowserTracerModel,
  type BrowserSpan,
  type BrowserSpanAttributes,
  type BrowserSpanRecorder,
  type BrowserStartSpanOptions,
  type Interaction,
  type StartInteractionOptions,
} from '../browser.js'
import type { BrowserSpanRecord } from '../browser-protocol.js'
import { redactIdentifier } from '../identifier.js'
import type { SpanContext } from '../traceparent.js'

export type {
  BrowserSpan,
  BrowserSpanAttributes,
  BrowserSpanRecord,
  BrowserSpanRecorder,
  BrowserStartSpanOptions,
  Interaction,
  SpanContext,
  StartInteractionOptions,
}

export { redactIdentifier }

/**
 * True when browser spans are recorded now: a dshx Client is connected and the Host has somewhere to send traces
 * (or has not answered yet), or a test recorder is active. Otherwise every span is a shared no-op.
 */
export const browserTracingEnabled = (): boolean => BrowserTracerModel.page().enabled

/**
 * Open an interaction (`thread switch`, `new thread`, `panel open`, `composer send`): a root span that stays the
 * ambient parent of every span and dshx API call the page starts until it ends, so the Host spans those calls cause
 * land in its trace. Opening one with the name of an open one supersedes it. End it with `endAfterPaint()` where the
 * result renders, or `end()`; an unended one closes as `timeout`.
 */
export const startInteraction = (name: string, options?: StartInteractionOptions): Interaction => BrowserTracerModel.page().startInteraction(name, options)

/** The open interaction with this name, to end it from the plugin that renders its result. */
export const openInteraction = (name: string): Interaction | undefined => BrowserTracerModel.page().interaction(name)

/** One-liner for the rendering side: end the open `name` interaction after the next paint; a no-op when none is open. */
export const endInteractionAfterPaint = (name: string, attributes?: BrowserSpanAttributes): void =>
  BrowserTracerModel.page().interaction(name)?.endAfterPaint(attributes)

/** Start a span the caller must `end()`; parented to the active span, else the open interaction. */
export const startSpan = (name: string, options?: BrowserStartSpanOptions): BrowserSpan => BrowserTracerModel.page().startSpan(name, options)

interface WithSpan {
  <T>(name: string, run: (span: BrowserSpan) => T | Promise<T>): Promise<T>
  <T>(name: string, options: BrowserStartSpanOptions, run: (span: BrowserSpan) => T | Promise<T>): Promise<T>
}

/**
 * Run `run` inside a span that ends when it settles. The browser has no async context: the span is the active parent
 * only during the synchronous part of `run`. Work that continues across awaits nests through an open interaction, or
 * an explicit `parent: span.context`.
 */
export const withSpan: WithSpan = <T>(
  name: string,
  optionsOrRun: BrowserStartSpanOptions | ((span: BrowserSpan) => T | Promise<T>),
  run?: (span: BrowserSpan) => T | Promise<T>,
): Promise<T> => {
  if (typeof optionsOrRun === 'function') return BrowserTracerModel.page().withSpan(name, {}, optionsOrRun)
  if (run === undefined) return Promise.reject(new TypeError('withSpan needs a callback'))
  return BrowserTracerModel.page().withSpan(name, optionsOrRun, run)
}

/** `fn` wrapped so each call runs in a span; `options` may be computed from the call's arguments (identities and counts only). */
export const traced =
  <Args extends readonly unknown[], Result>(
    name: string,
    fn: (...args: Args) => Result | Promise<Result>,
    options: BrowserStartSpanOptions | ((...args: Args) => BrowserStartSpanOptions) = {},
  ): ((...args: Args) => Promise<Result>) =>
  (...args) =>
    BrowserTracerModel.page().withSpan(name, typeof options === 'function' ? options(...args) : options, () => fn(...args))

export const activeSpanContext = (): SpanContext | undefined => BrowserTracerModel.page().activeContext()

/** The W3C `traceparent` for the active span or open interaction. dshx API calls already carry it. */
export const traceparent = (): string | undefined => BrowserTracerModel.page().traceparent()

/** Send every queued browser span to the Host now; resolves (never rejects) once each batch was tried. */
export const flushBrowserTracing = (): Promise<void> => BrowserTracerModel.page().flush()

/** Record every browser span ended on this page until `stop()` (or a `using` block ends), exporting or not. */
export const recordBrowserSpans = (): BrowserSpanRecorder => BrowserTracerModel.page().record()
