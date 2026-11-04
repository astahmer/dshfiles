import type { Context } from '@deepseek-ai/cordis'

/** The four logger verbs dshx calls, so a stub context can stand in for Cordis's logging service. */
export interface SafeLogger {
  debug(format: string, ...params: unknown[]): void
  info(format: string, ...params: unknown[]): void
  warn(format: string, ...params: unknown[]): void
  error(format: string, ...params: unknown[]): void
}

const consoleLogger: SafeLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (format, ...params) => console.warn(format, ...params),
  error: (format, ...params) => console.error(format, ...params),
}

/**
 * `ctx.logger(name)` on a real Cordis context; a bare context (a fixture, a probe, a test double) has no logging
 * service, and dshx must never fail a plugin because it wanted to log a warning.
 */
export const safeCordisLogger = (ctx: Context, name: string): SafeLogger => {
  const factory: unknown = (ctx as { logger?: unknown }).logger
  if (typeof factory !== 'function') return consoleLogger
  try {
    const logger: unknown = factory.call(ctx, name)
    const candidate = logger as Partial<SafeLogger> | undefined
    return typeof candidate?.warn === 'function' && typeof candidate.error === 'function' ? (candidate as SafeLogger) : consoleLogger
  } catch {
    return consoleLogger
  }
}
