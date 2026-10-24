import type { BrowserSpanRecord, BrowserResource } from './browser-protocol.js'
import type { BrowserTracer } from './browser.js'

/** How spans leave the page: the dshx client runtime attaches one per Connection (never a direct OTLP request). */
export interface BrowserTraceTransport {
  status(): Promise<unknown>
  export(input: { readonly resource: BrowserResource; readonly spans: readonly BrowserSpanRecord[] }): Promise<unknown>
}

interface BrowserTracingRegistry {
  /** Created by the first plugin that imports `@dshfiles/dshx/tracing/client`; absent on a page nobody instruments. */
  tracer: BrowserTracer | undefined
  readonly transports: BrowserTraceTransport[]
}

/**
 * The page-wide meeting point of every bundled dshx copy. Every API-capable Client registers its Connection transport
 * and reads the tracer here, so only plugins that instrument interactions bundle the tracer itself.
 */
const BROWSER_TRACING_KEY = Symbol.for('@dshfiles/dshx.browser-tracing.v1')

const registry = (): BrowserTracingRegistry => {
  // SAFETY: only this module writes the versioned symbol, and always a BrowserTracingRegistry.
  const holder = globalThis as { [BROWSER_TRACING_KEY]?: BrowserTracingRegistry }
  holder[BROWSER_TRACING_KEY] ??= { tracer: undefined, transports: [] }
  return holder[BROWSER_TRACING_KEY]
}

const attach = (transport: BrowserTraceTransport): (() => void) => {
  const { transports } = registry()
  transports.push(transport)
  return () => {
    const index = transports.lastIndexOf(transport)
    if (index >= 0) transports.splice(index, 1)
  }
}

export class BrowserTracingRegistryModel {
  static readonly current = registry
  static readonly attach = attach
}
