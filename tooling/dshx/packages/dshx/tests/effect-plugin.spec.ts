import { describe, expect, it } from '@effect/vitest'
import { Cause, Context, Deferred, Effect, Exit, Layer, Ref, Schema } from 'effect'
import { defineApi, isApiError, method } from '../src/api/index.js'
import { Api, DshxPlugin, HostContext, HostEvents, Tool } from '../src/effect/index.js'
import { createHostApiClient } from '../src/host/index.js'
import { tracerLayer } from '../src/effect/tracer.js'
import { recordSpans } from '../src/tracing/index.js'
import { TestHost } from './effect-test-host.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshx-effect-test/ping'(value: string): void
  }
}

class Journal extends Context.Service<Journal, { readonly entries: Ref.Ref<ReadonlyArray<string>>; readonly prefix: string }>()(
  '@dshfiles/dshx/tests/Journal',
) {}

const journalLayer = (input: { readonly prefix: string; readonly log: string[] }) =>
  Layer.effect(
    Journal,
    Effect.gen(function* () {
      const host = yield* HostContext
      const entries = yield* Ref.make<ReadonlyArray<string>>([])
      yield* Effect.acquireRelease(
        Effect.sync(() => input.log.push(`acquire ${host.packageId}`)),
        () => Effect.sync(() => input.log.push(`release ${host.packageId}`)),
      )
      return Journal.of({ entries, prefix: input.prefix })
    }),
  )

class JournalLocked extends Schema.TaggedError<JournalLocked>()('JournalLocked', { reason: Schema.String }, { dshxWireCode: 'journal-locked' }) {
  override get message(): string {
    return `The journal is locked: ${this.reason}.`
  }
}

const journalApi = (id: string) =>
  defineApi({
    id,
    version: 1,
    owner: `@test/${id}`,
    methods: {
      greet: method({ input: Schema.Struct({ name: Schema.String }), output: Schema.String }),
      wait: method({ input: Schema.Void, output: Schema.String }),
      lock: method({ input: Schema.Void, output: Schema.String }),
    },
  })

const journalHandlers = (contract: ReturnType<typeof journalApi>, input: { readonly waiting?: Deferred.Deferred<void>; readonly interrupted?: string[] }) =>
  Api.handlers(contract, {
    greet: Effect.fn('journal greet')(function* (greeting, call) {
      const journal = yield* Journal
      yield* Ref.update(journal.entries, entries => [...entries, greeting.name])
      return `${journal.prefix} ${greeting.name} (${call.caller.kind})`
    }),
    wait: () =>
      Effect.gen(function* () {
        if (input.waiting !== undefined) yield* Deferred.succeed(input.waiting, undefined)
        return yield* Effect.never
      }).pipe(Effect.onInterrupt(() => Effect.sync(() => input.interrupted?.push('wait')))),
    lock: () => Effect.fail(new JournalLocked({ reason: 'maintenance' })),
  })

const mount = (definition: unknown, packageId: string) =>
  Effect.gen(function* () {
    const host = yield* TestHost
    return yield* Effect.promise(() => host.mount(definition, { packageId }))
  })

const rejection = (call: () => Promise<unknown>) =>
  Effect.flip(
    Effect.tryPromise({ try: call, catch: error => (isApiError(error) ? error : new Error('The call failed without an ApiError.', { cause: error })) }),
  )

describe('DshxPlugin.make', () => {
  it.effect('serves API handlers in the plugin services and closes the Scope on unload', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const log: string[] = []
      const api = journalApi('journal-a')
      const plugin = yield* mount(
        DshxPlugin.make({ name: 'test-journal-a', layer: journalLayer({ prefix: 'Hello', log }), apis: [Api.bind(api, journalHandlers(api, {}))] }),
        '@test/journal-a',
      )
      expect(log).toEqual(['acquire @test/journal-a'])
      const client = createHostApiClient(host.ctx, api, '@test/caller')
      expect(yield* Effect.promise(() => client.greet({ name: 'Ada' }))).toBe('Hello Ada (plugin)')
      expect(yield* rejection(() => client.lock())).toMatchObject({ kind: 'remote', remoteCode: 'journal-locked', remoteDetails: { reason: 'maintenance' } })
      yield* Effect.promise(() => plugin.dispose())
      expect(log).toEqual(['acquire @test/journal-a', 'release @test/journal-a'])
      expect(yield* rejection(() => client.greet({ name: 'Ada' }))).toMatchObject({ kind: 'unavailable' })
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('keeps two plugins on one Host apart', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const log: string[] = []
      const first = journalApi('journal-b')
      const second = journalApi('journal-c')
      const firstPlugin = yield* mount(
        DshxPlugin.make({ name: 'test-journal-b', layer: journalLayer({ prefix: 'First', log }), apis: [Api.bind(first, journalHandlers(first, {}))] }),
        '@test/journal-b',
      )
      yield* mount(
        DshxPlugin.make({ name: 'test-journal-c', layer: journalLayer({ prefix: 'Second', log }), apis: [Api.bind(second, journalHandlers(second, {}))] }),
        '@test/journal-c',
      )
      expect(yield* Effect.promise(() => createHostApiClient(host.ctx, first, '@test/caller').greet({ name: 'a' }))).toBe('First a (plugin)')
      expect(yield* Effect.promise(() => createHostApiClient(host.ctx, second, '@test/caller').greet({ name: 'b' }))).toBe('Second b (plugin)')
      yield* Effect.promise(() => firstPlugin.dispose())
      expect(log).toEqual(['acquire @test/journal-b', 'acquire @test/journal-c', 'release @test/journal-b'])
      expect(yield* Effect.promise(() => createHostApiClient(host.ctx, second, '@test/caller').greet({ name: 'c' }))).toBe('Second c (plugin)')
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('interrupts the handler fiber when the API call is aborted', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const waiting = yield* Deferred.make<void>()
      const interrupted: string[] = []
      const api = journalApi('journal-d')
      yield* mount(
        DshxPlugin.make({
          name: 'test-journal-d',
          layer: journalLayer({ prefix: '', log: [] }),
          apis: [Api.bind(api, journalHandlers(api, { waiting, interrupted }))],
        }),
        '@test/journal-d',
      )
      const controller = new AbortController()
      const pending = createHostApiClient(host.ctx, api, '@test/caller').wait(undefined, { signal: controller.signal })
      yield* Deferred.await(waiting)
      controller.abort()
      expect(yield* rejection(() => pending)).toMatchObject({ kind: 'aborted' })
      expect(interrupted).toEqual(['wait'])
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('interrupts a tool fiber on abort and reports exposed failures to the agent', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const started = yield* Deferred.make<void>()
      const interrupted: string[] = []
      const slow = Tool.make({
        name: 'journal_slow',
        description: 'Wait until cancelled.',
        input: Schema.Struct({ label: Schema.String }),
        execute: input =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Effect.sync(() => interrupted.push(input.label))),
          ),
      })
      const entries = Tool.make({
        name: 'journal_entries',
        description: 'Read the journal.',
        input: Schema.Struct({ limit: Schema.Int }),
        output: Schema.Array(Schema.String),
        readOnly: true,
        render: output => output.join(', '),
        execute: Effect.fn('journal entries')(function* (input) {
          const journal = yield* Journal
          if (input.limit < 0) return yield* new JournalLocked({ reason: 'negative limit' })
          return [journal.prefix, ...(yield* Ref.get(journal.entries))].slice(0, input.limit)
        }),
      })
      yield* mount(DshxPlugin.make({ name: 'test-journal-e', layer: journalLayer({ prefix: 'Tools', log: [] }), tools: [slow, entries] }), '@test/journal-e')
      expect(host.tools.schemas().find(schema => schema.name === 'journal_entries')?.parameters).toEqual({
        type: 'object',
        properties: { limit: { type: 'integer' } },
        required: ['limit'],
        additionalProperties: false,
      })
      const read = yield* Effect.promise(() =>
        host.tools.execute({ callId: 'call-1' as never, name: 'journal_entries', arguments: { limit: 1 }, signal: new AbortController().signal }),
      )
      expect(read).toMatchObject({ isError: false, content: [{ type: 'text', text: 'Tools' }] })
      const locked = yield* Effect.promise(() =>
        host.tools.execute({ callId: 'call-2' as never, name: 'journal_entries', arguments: { limit: -1 }, signal: new AbortController().signal }),
      )
      expect(locked).toMatchObject({ isError: true })
      expect(JSON.stringify(locked.content)).toContain('The journal is locked: negative limit.')
      const invalid = yield* Effect.promise(() =>
        host.tools.execute({ callId: 'call-3' as never, name: 'journal_entries', arguments: { limit: 1, extra: true }, signal: new AbortController().signal }),
      )
      expect(invalid.isError).toBe(true)

      const controller = new AbortController()
      const pending = host.tools.execute({ callId: 'call-4' as never, name: 'journal_slow', arguments: { label: 'slow' }, signal: controller.signal })
      yield* Deferred.await(started)
      controller.abort()
      yield* Effect.promise(() => pending)
      expect(interrupted).toEqual(['slow'])
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('fails activation with the cause, closes the Scope and refuses calls', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const log: string[] = []
      const api = journalApi('journal-f')
      const failing = Layer.effectDiscard(Effect.fail(new JournalLocked({ reason: 'boot' })))
      const outcome = yield* Effect.exit(
        mount(
          DshxPlugin.make({
            name: 'test-journal-f',
            layer: Layer.merge(journalLayer({ prefix: '', log }), failing.pipe(Layer.provide(journalLayer({ prefix: '', log: [] })))),
            apis: [Api.bind(api, journalHandlers(api, {}))],
          }),
          '@test/journal-f',
        ),
      )
      expect(Exit.isFailure(outcome)).toBe(true)
      expect(log).toEqual(['acquire @test/journal-f', 'release @test/journal-f'])
      expect(yield* rejection(() => createHostApiClient(host.ctx, api, '@test/caller').greet({ name: 'a' }))).toMatchObject({ kind: 'unavailable' })
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('runs main, events and scoped tools for the plugin lifetime', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const seen = yield* Ref.make<ReadonlyArray<string>>([])
      const mainStopped = yield* Deferred.make<void>()
      const echo = Tool.make({
        name: 'journal_echo',
        description: 'Echo a word.',
        input: Schema.Struct({ word: Schema.String }),
        execute: input => Effect.succeed(input.word),
      })
      const plugin = yield* mount(
        DshxPlugin.make({
          name: 'test-journal-g',
          layer: journalLayer({ prefix: '', log: [] }),
          main: Effect.gen(function* () {
            yield* HostEvents.on('dshx-effect-test/ping', value => Ref.update(seen, values => [...values, value]))
            yield* Tool.register(echo).pipe(Effect.orDie)
            yield* Effect.never
          }).pipe(
            Effect.scoped,
            Effect.onInterrupt(() => Deferred.succeed(mainStopped, undefined)),
          ),
        }),
        '@test/journal-g',
      )
      yield* Effect.yieldNow
      host.ctx.emit('dshx-effect-test/ping', 'one')
      yield* Effect.yieldNow
      expect(yield* Ref.get(seen)).toEqual(['one'])
      expect(host.tools.schemas().some(schema => schema.name === 'journal_echo')).toBe(true)
      yield* Effect.promise(() => plugin.dispose())
      yield* Deferred.await(mainStopped)
      host.ctx.emit('dshx-effect-test/ping', 'two')
      expect(yield* Ref.get(seen)).toEqual(['one'])
      expect(host.tools.schemas().some(schema => schema.name === 'journal_echo')).toBe(false)
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('decodes the row config before building the layer', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const api = journalApi('journal-h')
      yield* Effect.promise(() =>
        host.mount(
          DshxPlugin.make({
            name: 'test-journal-h',
            Config: Schema.Struct({ prefix: Schema.String }),
            layer: config => journalLayer({ prefix: config.prefix, log: [] }),
            apis: [Api.bind(api, journalHandlers(api, {}))],
          }),
          { packageId: '@test/journal-h', config: { prefix: 'Configured' } },
        ),
      )
      expect(yield* Effect.promise(() => createHostApiClient(host.ctx, api, '@test/caller').greet({ name: 'x' }))).toBe('Configured x (plugin)')
    }).pipe(Effect.provide(TestHost.layer)),
  )
})

class Missing extends Context.Service<Missing, { readonly value: string }>()('@dshfiles/dshx/tests/Missing') {}

describe('DshxPlugin.make types', () => {
  it('refuses handlers and tools that need a service the layer does not build', () => {
    const api = journalApi('journal-types')
    const needsMissing = Api.bind(api, {
      greet: () =>
        Effect.gen(function* () {
          const missing = yield* Missing
          return missing.value
        }),
      wait: () => Effect.succeed(''),
      lock: () => Effect.succeed(''),
    })
    const missingTool = Tool.make({
      name: 'missing_tool',
      description: 'x',
      input: Schema.Struct({}),
      execute: () =>
        Effect.gen(function* () {
          const missing = yield* Missing
          return missing.value
        }),
    })
    const layer = journalLayer({ prefix: '', log: [] })
    // @ts-expect-error Missing is not built by the layer
    DshxPlugin.make({ name: 'types-a', layer, apis: [needsMissing] })
    // @ts-expect-error Missing is not built by the layer
    DshxPlugin.make({ name: 'types-b', layer, tools: [missingTool] })
    expect(DshxPlugin.make({ name: 'types-c', layer, apis: [Api.bind(api, journalHandlers(api, {}))] }).apis).toHaveLength(1)
  })
})

describe('DshxPlugin.callback', () => {
  it.effect('runs the Effect function in the services it was captured in', () =>
    Effect.gen(function* () {
      const greet = yield* DshxPlugin.callback((name: string) =>
        Effect.gen(function* () {
          const journal = yield* Journal
          return `${journal.prefix} ${name}`
        }),
      )
      expect(yield* Effect.promise(() => greet('Ada'))).toBe('Hi Ada')
      const failing = yield* DshxPlugin.callback(() => Effect.fail(new JournalLocked({ reason: 'x' })))
      expect(
        yield* Effect.promise(() =>
          failing().then(
            () => 'resolved',
            (error: unknown) => (error instanceof JournalLocked ? error.reason : 'other'),
          ),
        ),
      ).toBe('x')
    }).pipe(Effect.provide(Layer.succeed(Journal, Journal.of({ entries: Ref.makeUnsafe<ReadonlyArray<string>>([]), prefix: 'Hi' })))),
  )

  it.effect('starts its own trace instead of inheriting the span it was captured under', () =>
    Effect.gen(function* () {
      const probe = yield* DshxPlugin.callback(() => Effect.withSpan(Effect.void, 'callback probe')).pipe(Effect.withSpan('plugin activate'))
      const recorder = recordSpans()
      yield* Effect.promise(() => probe())
      recorder.stop()
      expect(recorder.span('callback probe').parentSpanId).toBeUndefined()
    }).pipe(Effect.provide(tracerLayer)),
  )

  it('is a Cause-preserving PluginActivationError', () => {
    const error = new DshxPlugin.PluginActivationError({ plugin: 'p', cause: Cause.fail('boot') })
    expect(error.message).toBe('p failed to activate. See the Host log for its cause.')
    expect(Cause.isCause(error.cause)).toBe(true)
  })
})
