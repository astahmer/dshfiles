import { Cause, Effect, Logger } from 'effect'
import { HostContext } from './host-context.js'

type SinkLevel = 'debug' | 'info' | 'warn' | 'error'

/** Where log lines go: the Cordis logger in a Host, an array in a test. */
export type LogSink = { readonly [Level in SinkLevel]: (line: string) => void }

const sinkLevel = (level: string): SinkLevel => {
  if (level === 'Fatal' || level === 'Error') return 'error'
  if (level === 'Warn') return 'warn'
  if (level === 'Info') return 'info'
  return 'debug'
}

const text = (part: unknown): string => {
  if (typeof part === 'string') return part
  if (part instanceof Error) return `${part.name}: ${part.message}`
  return JSON.stringify(part) ?? String(part)
}

/** An Effect Logger writing one line per log entry, with the pretty cause appended when the entry carries one. */
export const sinkLogger = (sink: LogSink) =>
  Logger.make(options => {
    const parts: ReadonlyArray<unknown> = Array.isArray(options.message) ? options.message : [options.message]
    const message = parts.map(text).join(' ')
    const line = options.cause.reasons.length === 0 ? message : `${message}\n${Cause.pretty(options.cause)}`
    sink[sinkLevel(options.logLevel)](line)
  })

/** `Effect.log*` from plugin code, written to the Host's Cordis logger of the activating package. */
export const hostLoggerLayer = Logger.layer([
  Effect.gen(function* () {
    const host = yield* HostContext
    const service: unknown = host.ctx.logger
    // A bare Cordis context (a fixture, a probe) may carry no logging service; fall back to the console instead of
    // failing the activation of every plugin that logs through Effect.
    if (typeof service !== 'function') {
      return sinkLogger({
        debug: () => undefined,
        info: () => undefined,
        warn: line => console.warn(line),
        error: line => console.error(line),
      })
    }
    // SAFETY: the guard above proves the service is callable, which is exactly Cordis's LoggerService shape.
    const logger = service.call(host.ctx, host.packageId) as ReturnType<typeof host.ctx.logger>
    return sinkLogger({
      debug: line => logger.debug(line),
      info: line => logger.info(line),
      warn: line => logger.warn(line),
      error: line => logger.error(line),
    })
  }),
])
