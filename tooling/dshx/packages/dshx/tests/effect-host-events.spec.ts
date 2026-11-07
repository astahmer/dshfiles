import { describe, expect, it } from '@effect/vitest'
import type { Message } from '@deepseek-ai/cordis'
import { Effect, Exit, Layer, Ref, Scope } from 'effect'
import { HostContext, HostEvents } from '../src/effect/index.js'
import { tracerLayer } from '../src/effect/tracer.js'
import { recordSpans } from '../src/tracing/index.js'
import { TestHost } from './effect-test-host.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshx-events-test/wrap'(value: string, next: () => string): string
    'dshx-events-test/ask'(key: string): string | undefined
    'dshx-events-test/async'(value: string, next: () => Promise<string>): Promise<string>
  }
}

const hostContext = Layer.effect(
  HostContext,
  Effect.map(TestHost, host => HostContext.of({ ctx: host.ctx, packageId: '@test/events' })),
)

const recordErrors = Effect.gen(function* () {
  const host = yield* TestHost
  const errors: string[] = []
  const exporter = host.ctx.logger.exporter({ export: (message: Message) => message.type === 'error' && errors.push(message.args.map(String).join(' ')) })
  yield* Effect.addFinalizer(() => Effect.sync(() => void exporter()))
  return errors
})

const withScope = <A, E, R>(body: (scope: Scope.Closeable) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make()
    return yield* body(scope)
  })

describe('HostEvents.intercept', () => {
  it.effect('wraps a waterfall dispatch, may skip next, and leaves the chain when its Scope closes', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const inner = yield* Ref.make(0)
      const builtIn = (value: string) => () => {
        Effect.runSync(Ref.update(inner, count => count + 1))
        return `built-in ${value}`
      }
      yield* withScope(scope =>
        Effect.gen(function* () {
          yield* HostEvents.intercept('dshx-events-test/wrap', ({ args, next }) =>
            args[0] === 'veto' ? Effect.succeed('vetoed') : Effect.map(next, result => `${result} wrapped`),
          ).pipe(Scope.provide(scope))
          expect(host.ctx.waterfall('dshx-events-test/wrap', 'a', builtIn('a'))).toBe('built-in a wrapped')
          expect(host.ctx.waterfall('dshx-events-test/wrap', 'veto', builtIn('veto'))).toBe('vetoed')
          expect(yield* Ref.get(inner)).toBe(1)
          yield* Scope.close(scope, Exit.void)
        }),
      )
      expect(host.ctx.waterfall('dshx-events-test/wrap', 'b', builtIn('b'))).toBe('built-in b')
    }).pipe(Effect.provide(hostContext), Effect.provide(TestHost.layer)),
  )

  it.effect('runs the rest of the chain once, logs a failing handler and rethrows the chain own error', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const errors = yield* recordErrors
      const calls = yield* Ref.make(0)
      yield* HostEvents.intercept('dshx-events-test/wrap', ({ next }) =>
        Effect.gen(function* () {
          yield* next
          yield* next
          return yield* Effect.die(new Error('interceptor broke'))
        }),
      )
      const counted = () => {
        Effect.runSync(Ref.update(calls, count => count + 1))
        return 'inner'
      }
      expect(host.ctx.waterfall('dshx-events-test/wrap', 'x', counted)).toBe('inner')
      expect(yield* Ref.get(calls)).toBe(1)
      expect(errors.some(line => line.includes('dshx-events-test/wrap') && line.includes('interceptor broke'))).toBe(true)
      expect(() =>
        host.ctx.waterfall('dshx-events-test/wrap', 'y', () => {
          throw new Error('adapter broke')
        }),
      ).toThrow('adapter broke')
    }).pipe(Effect.scoped, Effect.provide(hostContext), Effect.provide(TestHost.layer)),
  )

  it.effect('starts its own trace instead of the span it was registered under', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      yield* HostEvents.intercept('dshx-events-test/wrap', ({ next }) => Effect.withSpan(next, 'intercept probe')).pipe(Effect.withSpan('plugin activate'))
      const recorder = recordSpans()
      host.ctx.waterfall('dshx-events-test/wrap', 'x', () => 'inner')
      recorder.stop()
      expect(recorder.span('intercept probe').parentSpanId).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(hostContext, tracerLayer)), Effect.provide(TestHost.layer)),
  )
})

describe('HostEvents.interceptAsync', () => {
  it.effect('prepends an observer before an existing consuming answerer and disposes it with its scope', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const observed: string[] = []
      host.ctx.on('dshx-events-test/async', async value => `answer:${value}`)
      yield* withScope(scope =>
        Effect.gen(function* () {
          yield* HostEvents.interceptAsync(
            'dshx-events-test/async',
            ({ args: [value], next }) =>
              Effect.andThen(
                Effect.sync(() => observed.push(value)),
                next,
              ),
            { prepend: true },
          ).pipe(Scope.provide(scope))
          expect(yield* Effect.promise(() => host.ctx.waterfall('dshx-events-test/async', 'first', async () => 'unused'))).toBe('answer:first')
          expect(observed).toEqual(['first'])
          yield* Scope.close(scope, Exit.void)
        }),
      )
      expect(yield* Effect.promise(() => host.ctx.waterfall('dshx-events-test/async', 'second', async () => 'unused'))).toBe('answer:second')
      expect(observed).toEqual(['first'])
    }).pipe(Effect.provide(hostContext), Effect.provide(TestHost.layer)),
  )

  it.effect('a failed prepended observer delegates once without changing the answer', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      yield* recordErrors
      let answers = 0
      host.ctx.on('dshx-events-test/async', async () => {
        answers += 1
        return 'accepted'
      })
      yield* HostEvents.interceptAsync('dshx-events-test/async', () => Effect.die('storage unavailable'), { prepend: true })
      expect(yield* Effect.promise(() => host.ctx.waterfall('dshx-events-test/async', 'value', async () => 'unused'))).toBe('accepted')
      expect(answers).toBe(1)
    }).pipe(Effect.scoped, Effect.provide(hostContext), Effect.provide(TestHost.layer)),
  )
})

describe('HostEvents.answer', () => {
  it.effect('answers a bail dispatch, defers on undefined, logs a failure and stops with its Scope', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const errors = yield* recordErrors
      yield* withScope(scope =>
        Effect.gen(function* () {
          yield* HostEvents.answer('dshx-events-test/ask', key =>
            key === 'broken' ? Effect.die(new Error('answer broke')) : Effect.succeed(key === 'known' ? 'answered' : undefined),
          ).pipe(Scope.provide(scope))
          yield* HostEvents.answer('dshx-events-test/ask', () => Effect.succeed('fallback')).pipe(Scope.provide(scope))
          expect(host.ctx.bail('dshx-events-test/ask', 'known')).toBe('answered')
          expect(host.ctx.bail('dshx-events-test/ask', 'other')).toBe('fallback')
          expect(host.ctx.bail('dshx-events-test/ask', 'broken')).toBe('fallback')
          expect(errors.some(line => line.includes('answer broke'))).toBe(true)
          yield* Scope.close(scope, Exit.void)
        }),
      )
      expect(host.ctx.bail('dshx-events-test/ask', 'known')).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(hostContext), Effect.provide(TestHost.layer)),
  )

  it.effect('logs a handler that suspends instead of blocking the synchronous dispatch', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const errors = yield* recordErrors
      yield* HostEvents.answer('dshx-events-test/ask', () => Effect.as(Effect.sleep('1 millis'), 'late'))
      expect(host.ctx.bail('dshx-events-test/ask', 'x')).toBeUndefined()
      expect(errors.some(line => line.includes('dshx-events-test/ask'))).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(hostContext), Effect.provide(TestHost.layer)),
  )
})
