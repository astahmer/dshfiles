import { describe, expect, it } from '@effect/vitest'
import { Effect, Logger } from 'effect'
import { sinkLogger, type LogSink } from '../src/effect/host-logger.js'

const recordingSink = () => {
  const lines: Array<readonly [string, string]> = []
  const sink: LogSink = {
    debug: line => lines.push(['debug', line]),
    info: line => lines.push(['info', line]),
    warn: line => lines.push(['warn', line]),
    error: line => lines.push(['error', line]),
  }
  return { lines, sink }
}

describe('host logger', () => {
  it.effect('writes Effect logs to the sink by level, with the cause appended', () =>
    Effect.gen(function* () {
      const { lines, sink } = recordingSink()
      yield* Effect.gen(function* () {
        yield* Effect.logInfo('indexed', { files: 3 })
        yield* Effect.logWarning('slow pass')
        yield* Effect.logError('pass failed', new Error('disk full'))
      }).pipe(Effect.provide(Logger.layer([sinkLogger(sink)])))
      expect(lines[0]).toEqual(['info', 'indexed {"files":3}'])
      expect(lines[1]).toEqual(['warn', 'slow pass'])
      expect(lines[2]?.[0]).toBe('error')
      expect(lines[2]).toEqual(['error', 'pass failed Error: disk full'])
    }),
  )
})
