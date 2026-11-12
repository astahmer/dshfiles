import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Schema } from 'effect'
import { defineApi, isApiError, method } from '../src/api/index.js'
import { Api, DshxPlugin, HostContext } from '../src/effect/index.js'
import { createHostApiClient, type HostDefinition } from '../src/host/index.js'
import { recordSpans } from '../src/tracing/index.js'
import { TestHost } from './effect-test-host.js'

class Greeter extends Context.Service<Greeter, { readonly prefix: string; readonly greeted: Ref.Ref<ReadonlyArray<string>> }>()(
  '@dshfiles/dshx/tests/facade/Greeter',
) {}

class GreeterBusy extends Schema.TaggedError<GreeterBusy>()('GreeterBusy', { reason: Schema.String }, { dshxWireCode: 'greeter-busy' }) {
  override get message(): string {
    return `The greeter is busy: ${this.reason}.`
  }
}

const greeterApi = (id: string) =>
  defineApi({
    id,
    version: 1,
    owner: `@test/${id}`,
    methods: {
      greet: method({
        input: Schema.Struct({ name: Schema.String }),
        output: Schema.String,
        description: 'Greet someone by name.',
        tool: { name: `${id.replaceAll('-', '_')}_greet`, readOnly: true },
      }),
      busy: method({ input: Schema.Void, output: Schema.String }),
    },
  })

const greeterLayer = (input: { readonly prefix: string; readonly log: string[] }) =>
  Layer.effect(
    Greeter,
    Effect.gen(function* () {
      const host = yield* HostContext
      yield* Effect.acquireRelease(
        Effect.sync(() => input.log.push(`acquire ${host.packageId}`)),
        () => Effect.sync(() => input.log.push(`release ${host.packageId}`)),
      )
      return Greeter.of({ prefix: input.prefix, greeted: yield* Ref.make<ReadonlyArray<string>>([]) })
    }),
  )

const greeterImplementation = (contract: ReturnType<typeof greeterApi>, input: { readonly prefix: string; readonly log: string[] }) =>
  DshxPlugin.implementation({
    layer: greeterLayer(input),
    apis: [
      Api.bind(contract, {
        greet: request =>
          Greeter.use(greeter =>
            Effect.as(
              Ref.update(greeter.greeted, names => [...names, request.name]),
              `${greeter.prefix} ${request.name}`,
            ),
          ),
        busy: () => Effect.fail(new GreeterBusy({ reason: 'lunch' })),
      }),
    ],
  })

/** A `load` that counts its imports, like the dynamic `import()` of a built implementation chunk. */
const counted = <A>(module: () => Promise<A>) => {
  const loads: string[] = []
  return {
    loads,
    load: () => {
      loads.push('load')
      return module()
    },
  }
}

const mount = (definition: HostDefinition, packageId: string, config?: { readonly prefix: string }) =>
  Effect.gen(function* () {
    const host = yield* TestHost
    return yield* Effect.promise(() => host.mount(definition, config === undefined ? { packageId } : { packageId, config }))
  })

const rejection = <A>(call: () => Promise<A>) =>
  Effect.flip(
    Effect.tryPromise({ try: call, catch: error => (isApiError(error) ? error : new Error('The call failed without an ApiError.', { cause: error })) }),
  )

describe('DshxPlugin.facade', () => {
  it.effect('registers the contract and its method tool at mount, and imports the implementation on the first call only', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const log: string[] = []
      const api = greeterApi('facade-a')
      const module = counted(async () => ({ default: greeterImplementation(api, { prefix: 'Hello', log }) }))
      const plugin = yield* mount(DshxPlugin.facade({ name: 'test-facade-a', apis: [api], load: module.load }), '@test/facade-a')
      expect(module.loads).toEqual([])
      expect(log).toEqual([])
      expect(host.tools.get('facade_a_greet')?.name).toBe('facade_a_greet')
      const client = createHostApiClient(host.ctx, api, '@test/caller')
      expect(yield* Effect.promise(() => client.greet({ name: 'Ada' }))).toBe('Hello Ada')
      expect(yield* Effect.promise(() => client.greet({ name: 'Bob' }))).toBe('Hello Bob')
      expect(module.loads).toEqual(['load'])
      expect(log).toEqual(['acquire @test/facade-a'])
      yield* Effect.promise(() => plugin.dispose())
      expect(log).toEqual(['acquire @test/facade-a', 'release @test/facade-a'])
      expect(yield* rejection(() => client.greet({ name: 'Ada' }))).toMatchObject({ kind: 'unavailable' })
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('answers the contract method tool through the facade', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const api = greeterApi('facade-tool')
      const module = counted(async () => ({ default: greeterImplementation(api, { prefix: 'Tool', log: [] }) }))
      yield* mount(DshxPlugin.facade({ name: 'test-facade-tool', apis: [api], load: module.load }), '@test/facade-tool')
      const result = yield* Effect.promise(() =>
        host.tools.execute({ callId: 'call-1' as never, name: 'facade_tool_greet', arguments: { name: 'Ada' }, signal: new AbortController().signal }),
      )
      expect(result).toMatchObject({ isError: false })
      expect(JSON.stringify(result)).toContain('Tool Ada')
      expect(module.loads).toEqual(['load'])
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('keeps a handler failure and its wire code', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const api = greeterApi('facade-busy')
      yield* mount(
        DshxPlugin.facade({ name: 'test-facade-busy', apis: [api], load: async () => ({ default: greeterImplementation(api, { prefix: '', log: [] }) }) }),
        '@test/facade-busy',
      )
      const client = createHostApiClient(host.ctx, api, '@test/caller')
      expect(yield* rejection(() => client.busy())).toMatchObject({ kind: 'remote', remoteCode: 'greeter-busy', remoteDetails: { reason: 'lunch' } })
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('shares one import and one build between concurrent first calls', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const gate = yield* Deferred.make<void>()
      const importing = yield* Deferred.make<void>()
      const api = greeterApi('facade-race')
      const module = counted(async () => {
        await Effect.runPromise(Deferred.succeed(importing, undefined))
        await Effect.runPromise(Deferred.await(gate))
        return { default: greeterImplementation(api, { prefix: 'Once', log: [] }) }
      })
      yield* mount(DshxPlugin.facade({ name: 'test-facade-race', apis: [api], load: module.load }), '@test/facade-race')
      const client = createHostApiClient(host.ctx, api, '@test/caller')
      const calls = yield* Effect.all([Effect.promise(() => client.greet({ name: 'a' })), Effect.promise(() => client.greet({ name: 'b' }))], {
        concurrency: 2,
      }).pipe(Effect.forkScoped)
      yield* Deferred.await(importing)
      yield* Deferred.succeed(gate, undefined)
      expect(yield* Fiber.join(calls)).toEqual(['Once a', 'Once b'])
      expect(module.loads).toEqual(['load'])
    }).pipe(Effect.scoped, Effect.provide(TestHost.layer)),
  )

  it.effect('fails the first call when the import fails, and refuses later calls without importing again', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const api = greeterApi('facade-import-fail')
      const module = counted(() => Promise.reject(new Error('Cannot find module ./host-implementation.js')))
      yield* mount(DshxPlugin.facade({ name: 'test-facade-import-fail', apis: [api], load: module.load }), '@test/facade-import-fail')
      const client = createHostApiClient(host.ctx, api, '@test/caller')
      expect(yield* rejection(() => client.greet({ name: 'a' }))).toMatchObject({ kind: 'remote', remoteCode: 'plugin-inactive', retryable: false })
      expect(yield* rejection(() => client.greet({ name: 'b' }))).toMatchObject({ kind: 'remote', remoteCode: 'plugin-inactive' })
      expect(module.loads).toEqual(['load'])
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('refuses an implementation that does not serve exactly the declared methods, and builds nothing', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const log: string[] = []
      const declared = greeterApi('facade-mismatch')
      const other = greeterApi('facade-mismatch-other')
      yield* mount(
        DshxPlugin.facade({
          name: 'test-facade-mismatch',
          apis: [declared],
          load: async () => ({ default: greeterImplementation(other, { prefix: '', log }) }),
        }),
        '@test/facade-mismatch',
      )
      expect(yield* rejection(() => createHostApiClient(host.ctx, declared, '@test/caller').greet({ name: 'a' }))).toMatchObject({
        kind: 'remote',
        remoteCode: 'plugin-inactive',
      })
      expect(log).toEqual([])
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it('names what a mismatched implementation is missing and adds', () => {
    const error = new DshxPlugin.PluginImplementationMismatch({ plugin: 'p', missing: ['a.greet'], unexpected: ['b.greet'] })
    expect(error.message).toContain('missing: a.greet; unexpected: b.greet')
    expect(new DshxPlugin.PluginLoadError({ plugin: 'p' }).message).toContain('dshx build')
  })

  it.effect('decodes Config at mount, imports nothing for a bad one, and hands a good one to the implementation layer', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const Config = Schema.Struct({ prefix: Schema.String })
      const api = greeterApi('facade-config')
      const module = counted(async () => ({
        default: DshxPlugin.implementation({
          layer: (config: typeof Config.Type) => greeterLayer({ prefix: config.prefix, log: [] }),
          apis: [
            Api.bind(api, { greet: request => Greeter.use(greeter => Effect.succeed(`${greeter.prefix} ${request.name}`)), busy: () => Effect.succeed('') }),
          ],
        }),
      }))
      const definition = DshxPlugin.facade({ name: 'test-facade-config', Config, apis: [api], load: module.load })
      const bad = yield* Effect.exit(Effect.promise(() => host.mount(definition, { packageId: '@test/facade-config', config: {} })))
      expect(Exit.isFailure(bad)).toBe(true)
      expect(module.loads).toEqual([])
      yield* mount(definition, '@test/facade-config', { prefix: 'Configured' })
      expect(yield* Effect.promise(() => createHostApiClient(host.ctx, api, '@test/caller').greet({ name: 'a' }))).toBe('Configured a')
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('imports nothing when unloaded before the first call', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const api = greeterApi('facade-unload')
      const module = counted(async () => ({ default: greeterImplementation(api, { prefix: '', log: [] }) }))
      const plugin = yield* mount(DshxPlugin.facade({ name: 'test-facade-unload', apis: [api], load: module.load }), '@test/facade-unload')
      yield* Effect.promise(() => plugin.dispose())
      expect(yield* rejection(() => createHostApiClient(host.ctx, api, '@test/caller').greet({ name: 'a' }))).toMatchObject({ kind: 'unavailable' })
      expect(module.loads).toEqual([])
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('starts the implementation main after the first load, not at mount', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const running = yield* Deferred.make<void>()
      const api = greeterApi('facade-main')
      yield* mount(
        DshxPlugin.facade({
          name: 'test-facade-main',
          apis: [api],
          load: async () => ({
            default: DshxPlugin.implementation({
              layer: greeterLayer({ prefix: 'Main', log: [] }),
              main: Deferred.succeed(running, undefined).pipe(Effect.andThen(Effect.never)),
              apis: [
                Api.bind(api, {
                  greet: request => Greeter.use(greeter => Effect.succeed(`${greeter.prefix} ${request.name}`)),
                  busy: () => Effect.succeed(''),
                }),
              ],
            }),
          }),
        }),
        '@test/facade-main',
      )
      expect(yield* Deferred.isDone(running)).toBe(false)
      expect(yield* Effect.promise(() => createHostApiClient(host.ctx, api, '@test/caller').greet({ name: 'a' }))).toBe('Main a')
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(running)).toBe(true)
    }).pipe(Effect.provide(TestHost.layer)),
  )

  it.effect('records the import as a plugin load span under the facade activation', () =>
    Effect.gen(function* () {
      const host = yield* TestHost
      const api = greeterApi('facade-span')
      yield* mount(
        DshxPlugin.facade({ name: 'test-facade-span', apis: [api], load: async () => ({ default: greeterImplementation(api, { prefix: '', log: [] }) }) }),
        '@test/facade-span',
      )
      const recorder = recordSpans()
      yield* Effect.promise(() => createHostApiClient(host.ctx, api, '@test/caller').greet({ name: 'a' }))
      recorder.stop()
      const activate = recorder.span('plugin activate')
      const load = recorder.span('plugin load')
      expect(activate.attributes).toMatchObject({ 'dshx.plugin.package': '@test/facade-span', 'dshx.plugin.lazy': true, 'dshx.plugin.facade': true })
      expect(load.attributes).toMatchObject({ 'dshx.plugin.package': '@test/facade-span' })
      expect(load.parentSpanId).toBe(activate.spanId)
    }).pipe(Effect.provide(TestHost.layer)),
  )
})

class Missing extends Context.Service<Missing, { readonly value: string }>()('@dshfiles/dshx/tests/facade/Missing') {}

describe('DshxPlugin.facade types', () => {
  it('checks the implementation against its own layer and the facade Config', () => {
    const api = greeterApi('facade-types')
    const layer = greeterLayer({ prefix: '', log: [] })
    const needsMissing = Api.bind(api, { greet: () => Missing.use(missing => Effect.succeed(missing.value)), busy: () => Effect.succeed('') })
    // @ts-expect-error Missing is not built by the layer
    DshxPlugin.implementation({ layer, apis: [needsMissing] })
    const Config = Schema.Struct({ prefix: Schema.String })
    const wrongConfig = DshxPlugin.implementation({
      layer: (config: { readonly other: number }) => greeterLayer({ prefix: String(config.other), log: [] }),
      apis: [],
    })
    // @ts-expect-error the implementation layer reads a config the facade does not decode
    DshxPlugin.facade({ name: 'types-a', Config, apis: [api], load: async () => ({ default: wrongConfig }) })
    const ignoresConfig = DshxPlugin.implementation({ layer, apis: [] })
    expect(DshxPlugin.facade({ name: 'types-b', Config, apis: [api], load: async () => ({ default: ignoresConfig }) }).apis).toHaveLength(1)
  })
})
