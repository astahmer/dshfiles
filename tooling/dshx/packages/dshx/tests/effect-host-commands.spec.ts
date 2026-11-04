import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { Message } from '@deepseek-ai/cordis'
import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Layer, Ref } from 'effect'
import { DshxPlugin, HostEvents } from '../src/effect/index.js'
import { HostCommands } from '../src/effect/host-commands.js'
import { HostPrompt } from '../src/effect/host-prompt.js'
import { TestHost } from './effect-test-host.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshx-commands-test/admit'(value: string, next: () => Promise<string>): Promise<string>
  }
}

class Greeting extends Context.Service<Greeting, { readonly word: Ref.Ref<string> }>()('@dshfiles/dshx/tests/Greeting') {
  static readonly layer = Layer.effect(
    Greeting,
    Effect.map(Ref.make('Hello'), word => Greeting.of({ word })),
  )
}

const invocation = (input: { readonly rawInput: string; readonly signal?: AbortSignal }): CommandInvocation =>
  // SAFETY: these handlers read only rawInput and signal; a full CommandInvocation needs a live Agent.
  ({ rawInput: input.rawInput, signal: input.signal ?? new AbortController().signal }) as never

const recordErrors = Effect.gen(function* () {
  const host = yield* TestHost
  const errors: string[] = []
  const exporter = host.ctx.logger.exporter({ export: (message: Message) => message.type === 'error' && errors.push(message.args.map(String).join(' ')) })
  yield* Effect.addFinalizer(() => Effect.sync(() => void exporter()))
  return errors
})

const mountGreeter = (input: { readonly started: Deferred.Deferred<void>; readonly interrupted: Deferred.Deferred<void> }) =>
  Effect.gen(function* () {
    const host = yield* TestHost
    return yield* Effect.promise(() =>
      host.mount(
        DshxPlugin.make({
          name: 'test-greeter',
          layer: Layer.effectDiscard(
            Effect.gen(function* () {
              yield* HostCommands.register({
                name: 'greet',
                description: 'Greet someone.',
                input: { hint: '<name>' },
                handler: command =>
                  Effect.gen(function* () {
                    const name = command.rawInput.trim()
                    if (name === 'slow') {
                      yield* Deferred.succeed(input.started, undefined)
                      return yield* Effect.never.pipe(Effect.onInterrupt(() => Deferred.succeed(input.interrupted, undefined)))
                    }
                    if (name === 'broken') return yield* Effect.die(new Error('greeter broke'))
                    if (name.length === 0) return { kind: 'error', text: 'Usage: /greet <name>' }
                    const greeting = yield* Greeting
                    return { kind: 'success', text: `${yield* Ref.get(greeting.word)} ${name}` }
                  }),
              })
              yield* HostPrompt.section({ name: 'test-greeter:policy', order: 700, interpolate: false, text: 'Always greet.' })
              yield* HostPrompt.context({
                name: 'test-greeter:word',
                order: 300,
                interpolate: false,
                text: () => Effect.flatMap(Greeting, greeting => Effect.map(Ref.get(greeting.word), word => `Greeting word: ${word}`)),
              })
              yield* HostPrompt.context({ name: 'test-greeter:broken', order: 301, text: () => Effect.die(new Error('context broke')) })
              yield* HostEvents.interceptAsync('dshx-commands-test/admit', ({ args: [value], next }) =>
                value === 'reject'
                  ? Effect.succeed('rejected')
                  : value === 'broken'
                    ? Effect.die(new Error('admit broke'))
                    : Effect.map(Effect.andThen(Effect.sleep('1 millis'), next), result => `${result} admitted`),
              )
            }),
          ).pipe(Layer.provideMerge(Greeting.layer)),
        }),
        { packageId: '@test/greeter' },
      ),
    )
  })

describe('HostCommands.register', () => {
  it.effect('runs an Effect handler, logs a defect, interrupts on abort and unregisters on unload', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const errors = yield* recordErrors
      const started = yield* Deferred.make<void>()
      const interrupted = yield* Deferred.make<void>()
      const plugin = yield* mountGreeter({ started, interrupted })
      const command = host.commands.get('greet')
      if (command === undefined) return expect.fail('the plugin registers /greet')
      expect(command.input).toEqual({ hint: '<name>' })
      const run = (rawInput: string, signal?: AbortSignal) => Effect.promise(async () => command.handler(invocation({ rawInput, ...(signal && { signal }) })))
      expect(yield* run(' Ada')).toEqual({ kind: 'success', text: 'Hello Ada' })
      expect(yield* run('')).toEqual({ kind: 'error', text: 'Usage: /greet <name>' })
      expect(yield* run('broken')).toEqual({ kind: 'error', text: '/greet failed. See Host diagnostics.' })
      expect(errors.some(line => line.includes('greeter broke'))).toBe(true)

      const controller = new AbortController()
      const pending = Promise.resolve(command.handler(invocation({ rawInput: 'slow', signal: controller.signal }))).then(
        () => 'resolved',
        (error: unknown) => (error === controller.signal.reason ? 'aborted' : 'other'),
      )
      yield* Deferred.await(started)
      controller.abort()
      yield* Deferred.await(interrupted)
      expect(yield* Effect.promise(() => pending)).toBe('aborted')

      yield* Effect.promise(() => plugin.dispose())
      expect(host.commands.get('greet')).toBeUndefined()
    }).pipe(Effect.scoped, Effect.provide(TestHost.layer)),
  )
})

describe('HostPrompt', () => {
  it.effect('contributes sections and Effect contexts for the plugin lifetime, logging a failing text', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const errors = yield* recordErrors
      const plugin = yield* mountGreeter({ started: yield* Deferred.make<void>(), interrupted: yield* Deferred.make<void>() })
      const assembly = yield* Effect.promise(() => host.ctx.systemPrompt.assemble())
      expect(assembly.sections.find(section => section.name === 'test-greeter:policy')?.text).toBe('Always greet.')
      expect(assembly.contexts.find(context => context.name === 'test-greeter:word')?.text).toBe('Greeting word: Hello')
      expect(assembly.contexts.some(context => context.name === 'test-greeter:broken' && context.text !== '')).toBe(false)
      expect(errors.some(line => line.includes('test-greeter:broken') && line.includes('context broke'))).toBe(true)
      yield* Effect.promise(() => plugin.dispose())
      const after = yield* Effect.promise(() => host.ctx.systemPrompt.assemble())
      expect(after.sections.some(section => section.name === 'test-greeter:policy')).toBe(false)
      expect(after.contexts.some(context => context.name === 'test-greeter:word')).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(TestHost.layer)),
  )
})

describe('HostEvents.interceptAsync', () => {
  it.effect('resolves an asynchronous waterfall with the handler result or a veto', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      yield* mountGreeter({ started: yield* Deferred.make<void>(), interrupted: yield* Deferred.make<void>() })
      const builtIn = (value: string) => () => Promise.resolve(`built-in ${value}`)
      expect(yield* Effect.promise(() => host.ctx.waterfall('dshx-commands-test/admit', 'a', builtIn('a')))).toBe('built-in a admitted')
      expect(yield* Effect.promise(() => host.ctx.waterfall('dshx-commands-test/admit', 'reject', builtIn('reject')))).toBe('rejected')
      expect(yield* Effect.promise(() => host.ctx.waterfall('dshx-commands-test/admit', 'broken', builtIn('broken')))).toBe('built-in broken')
      const failed = yield* Effect.promise(() =>
        host.ctx
          .waterfall('dshx-commands-test/admit', 'b', () => Promise.reject(new Error('chain broke')))
          .then(
            () => 'resolved',
            (error: unknown) => (error instanceof Error ? error.message : 'other'),
          ),
      )
      expect(failed).toBe('chain broke')
    }).pipe(Effect.scoped, Effect.provide(TestHost.layer)),
  )
})
