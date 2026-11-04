import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Fiber, Layer, Option, Schema, Stream } from 'effect'
import { defineApi, method } from '../src/api/index.js'
import { connectCommunicationClient, startHostCommunicationBridge } from '../src/communication/bridge.js'
import { createCommunicationService } from '../src/communication/service.js'
import { Communication, CommunicationFailed } from '../src/effect/communication.js'
import { DshxEffect } from '../src/effect/index.js'
import { HostApis } from '../src/effect/host-apis.js'
import { HostContext } from '../src/effect/host-context.js'
import { HostTerminal } from '../src/effect/host-terminal.js'
import { Llm, LlmModelInfoFailed } from '../src/effect/llm.js'
import { PluginStorage } from '../src/effect/plugin-storage.js'
import { PluginStorageModel } from '../src/host/plugin-storage.js'
import { EffectHostServiceError, SettingsRead } from '../src/effect/services.js'
import { Settings, SettingsConflict, SettingsWriteFailed } from '../src/effect/settings.js'
import { defineSettings } from '../src/settings/index.js'
import type { SettingsValue } from '../src/settings/types.js'
import SchemaStery from '@deepseek-ai/schemastery'
import { StorageDomain } from '../src/effect/storage-domain.js'
import { defineHost } from '../src/host/index.js'
import { createTestHost } from '../src/testing/index.js'

const temporaryDirectory = (prefix: string) =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), prefix))),
    directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  )

const cordisHost = (packageId: string, setup: (ctx: CordisContext) => PromiseLike<unknown>) =>
  Layer.effect(
    HostContext,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const ctx = new CordisContext()
        await setup(ctx)
        return ctx
      }),
      ctx => Effect.promise(() => ctx.fiber.dispose()),
    ).pipe(Effect.map(ctx => HostContext.of({ ctx, packageId }))),
  )

const storageHost = Layer.unwrap(
  Effect.map(temporaryDirectory('dshx-effect-storage-'), root =>
    cordisHost('@test/effect-storage', async ctx => {
      await ctx.plugin(Storage)
      await ctx.plugin(StorageJson, { root })
      await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
    }),
  ),
)

const Note = Schema.Struct({ text: Schema.String, count: Schema.Number })
type Note = typeof Note.Type

const notesDomain = StorageDomainPlugin.defineDomain({
  name: 'dshx_effect_notes',
  version: 1,
  tables: { notes: StorageDomainPlugin.domainTable<string, Note>(PluginStorageModel.toStorageSchema(Note)) },
})

describe('StorageDomain', () => {
  it.layer(StorageDomain.layer.pipe(Layer.provideMerge(storageHost)))(layer => {
    layer.effect('opens a domain for a Scope with serialized writes and a change stream', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* StorageDomain
          const domain = yield* storage.open(notesDomain)
          const notes = domain.table('notes')
          const changes = yield* Stream.runCollect(Stream.take(domain.changes, 3)).pipe(Effect.forkChild)
          yield* Effect.yieldNow

          yield* notes.put('one', { text: 'first', count: 0 })
          yield* Effect.forEach(
            [1, 2, 3],
            () =>
              domain.withWriteLock(
                Effect.flatMap(notes.get('one'), current => notes.put('one', { text: 'first', count: Option.getOrThrow(current).count + 1 })),
              ),
            {
              concurrency: 'unbounded',
            },
          )
          expect(yield* notes.get('one')).toEqual(Option.some({ text: 'first', count: 3 }))
          expect(yield* notes.update('one', note => ({ ...note, text: 'updated' }))).toEqual({ text: 'updated', count: 3 })
          expect(yield* notes.delete('one')).toBe(true)
          expect(yield* notes.get('one')).toEqual(Option.none())
          expect(yield* notes.size).toBe(0)

          const observed = yield* Fiber.join(changes)
          expect(observed.map(change => [change.table, change.key, change.operation])).toEqual([
            ['notes', 'one', 'put'],
            ['notes', 'one', 'put'],
            ['notes', 'one', 'put'],
          ])
        }),
      ),
    )

    layer.effect('fails a write the domain schema rejects with its cause', () =>
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* StorageDomain
          const domain = yield* storage.open(notesDomain)
          const failure = yield* domain
            .table('notes')
            .update('missing', note => note)
            .pipe(Effect.flip)
          expect(failure._tag).toBe('StorageDomainWriteFailed')
          expect(failure.code).toBe('missing-key')
          expect(failure.cause).toBeInstanceOf(Error)
        }),
      ),
    )

    layer.effect('closes the domain with its Scope so it can be opened again', () =>
      Effect.gen(function* () {
        const storage = yield* StorageDomain
        yield* Effect.scoped(Effect.flatMap(storage.open(notesDomain), domain => domain.table('notes').put('kept', { text: 'durable', count: 1 })))
        const reopened = yield* Effect.scoped(Effect.flatMap(storage.open(notesDomain), domain => domain.table('notes').get('kept')))
        expect(reopened).toEqual(Option.some({ text: 'durable', count: 1 }))
        const twice = yield* Effect.scoped(Effect.andThen(storage.open(notesDomain), storage.open(notesDomain))).pipe(Effect.flip)
        expect(twice.code).toBe('already-open')
      }),
    )
  })
})

describe('PluginStorage', () => {
  it.layer(PluginStorage.layer.pipe(Layer.provideMerge(storageHost)))(layer => {
    layer.effect('reads and writes the activating package namespace and streams its changes', () =>
      Effect.gen(function* () {
        const storage = yield* PluginStorage
        expect(storage.namespace).toBe('@test/effect-storage')
        const changes = yield* Stream.runCollect(Stream.take(storage.changes('records/'), 2)).pipe(Effect.forkChild)
        yield* Effect.yieldNow

        yield* storage.set('other', 1)
        expect(yield* storage.set('records/one', { value: 1 })).toMatchObject({ key: 'records/one', value: { value: 1 } })
        expect(yield* storage.get('records/one')).toEqual(Option.some(expect.objectContaining({ value: { value: 1 } })))
        expect((yield* storage.list({ prefix: 'records/' })).entries.map(entry => entry.key)).toEqual(['records/one'])
        expect(yield* storage.delete('records/one')).toBe(true)

        expect([...(yield* Fiber.join(changes))]).toEqual([
          { key: 'records/one', deleted: false },
          { key: 'records/one', deleted: true },
        ])
      }),
    )

    layer.effect('rejects an invalid key before touching storage', () =>
      Effect.gen(function* () {
        const storage = yield* PluginStorage
        const failure = yield* storage.set('', 'invalid key').pipe(Effect.flip)
        expect(failure._tag).toBe('PluginStorageInvalidInput')
        expect(failure.cause).toBeDefined()
      }),
    )
  })
})

describe('Settings', () => {
  it('returns the same service key for the same namespace', () => {
    expect(Settings.Tag('dshfiles-example')).toBe(Settings.Tag('dshfiles-example'))
    expect(Settings.Tag('dshfiles-example')).not.toBe(Settings.Tag('dshfiles-other'))
  })

  const ExampleSettings = Settings.Tag<{ readonly enabled: boolean; readonly limit: number }>('dshfiles-example')

  it.layer(Settings.layerTest('dshfiles-example', { enabled: false, limit: 1 }))(layer => {
    layer.effect('streams the current value and every update, and refuses a stale revision', () =>
      Effect.gen(function* () {
        const settings = yield* ExampleSettings
        const values = yield* Stream.runCollect(Stream.take(settings.changes, 3)).pipe(Effect.forkChild)
        yield* Effect.yieldNow

        yield* settings.update({ enabled: true })
        const { revision } = yield* settings.snapshot
        yield* settings.update({ limit: 5 }, revision)
        const conflict = yield* settings.update({ limit: 9 }, revision).pipe(Effect.flip)

        expect(conflict).toBeInstanceOf(SettingsConflict)
        expect(yield* settings.get).toEqual({ enabled: true, limit: 5 })
        expect([...(yield* Fiber.join(values))]).toEqual([
          { enabled: false, limit: 1 },
          { enabled: true, limit: 1 },
          { enabled: true, limit: 5 },
        ])
      }),
    )
  })

  const fallbackSettings = defineSettings({
    namespace: 'dshfiles-fallback',
    schema: SchemaStery.object({ rules: SchemaStery.array(SchemaStery.string()).default([]), limit: SchemaStery.natural().default(3) }),
  })

  it.layer(Settings.layer(fallbackSettings).pipe(Layer.provide(cordisHost('@test/settings-fallback', async () => undefined))))(layer => {
    layer.effect('activates on the schema defaults when the Host has no entry, and refuses writes', () =>
      Effect.gen(function* () {
        const settings = yield* Settings.Tag<SettingsValue<(typeof fallbackSettings)['schema']>>('dshfiles-fallback')
        expect(yield* settings.get).toEqual({ rules: [], limit: 3 })
        expect(yield* settings.update({ limit: 4 }).pipe(Effect.flip)).toBeInstanceOf(SettingsWriteFailed)
      }),
    )
  })

  it.effect('keeps the deprecated SettingsRead failure cause', () =>
    Effect.gen(function* () {
      const read = SettingsRead.make<{ readonly enabled: boolean }>('dshfiles-legacy')
      const thrown = new Error('not serialized')
      const failure = yield* Effect.flatMap(read.Tag, settings => settings.get()).pipe(
        Effect.provide(
          read.layer({
            get: () => {
              throw thrown
            },
          }),
        ),
        Effect.flip,
      )
      expect(failure).toBeInstanceOf(EffectHostServiceError)
      expect(failure.cause).toBe(thrown)
    }),
  )
})

describe('HostApis', () => {
  it.effect('calls another plugin API as the activating package', () =>
    Effect.gen(function* () {
      const host = yield* Effect.acquireRelease(
        Effect.promise(() => createTestHost()),
        testHost => Effect.promise(() => testHost.dispose()),
      )
      const statusApi = defineApi({ id: 'status', version: 1, owner: '@test/status', methods: { read: method<void, string>() } })
      yield* Effect.promise(() =>
        host.mount(defineHost({ apis: [DshxEffect.host(statusApi, { read: () => Effect.succeed('ready') })] }), { packageId: '@test/status' }),
      )

      const apis = yield* Effect.provide(
        HostApis,
        HostApis.layer.pipe(Layer.provide(Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@test/caller' })))),
      )
      expect(yield* apis.client(statusApi).read()).toBe('ready')
      expect(yield* apis.isServed(statusApi)).toBe(true)
      expect((yield* apis.list).some(api => api.id === 'status' && api.owner === '@test/status')).toBe(true)
    }).pipe(Effect.scoped),
  )
})

describe('Communication', () => {
  it.live('lifts every bridge method and streams new inbox messages once', () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory('dshx-effect-communication-')
      const service = createCommunicationService({ statePath: join(directory, 'messages.json') })
      yield* Effect.acquireRelease(
        Effect.promise(() => startHostCommunicationBridge(service, { stateHome: directory, listAgents: () => [] })),
        bridge => Effect.promise(() => bridge.close()),
      )
      const sender = yield* Effect.promise(() => connectCommunicationClient({ stateHome: directory, principalId: 'sender' }))

      const communication = yield* Effect.provide(Communication, Communication.layer({ stateHome: directory, principalId: 'reader' }))
      expect(communication.principal).toEqual({ kind: 'external', id: 'reader' })
      expect(yield* communication.listAgents()).toEqual([])
      yield* communication.subscribe({ topic: 'builds.ready' })
      expect(yield* communication.listTopics()).toMatchObject([{ topic: 'builds.ready', subscribers: 1 }])

      const inbox = yield* Stream.runCollect(Stream.take(communication.messages({ every: '20 millis' }), 2)).pipe(Effect.forkChild)
      yield* Effect.promise(() => sender.publish({ topic: 'builds.ready', text: 'first' }))
      yield* Effect.promise(() => sender.publish({ topic: 'builds.ready', text: 'second' }))
      const received = yield* Fiber.join(inbox).pipe(Effect.timeout('5 seconds'))
      expect(received.map(message => message.text).sort()).toEqual(['first', 'second'])

      const failure = yield* communication.acknowledge('not-a-uuid').pipe(Effect.flip)
      expect(failure).toBeInstanceOf(CommunicationFailed)
      expect(failure.operation).toBe('acknowledge')
      expect(failure.cause).toBeDefined()
    }).pipe(Effect.scoped),
  )

  it.effect('fails to connect with a typed cause when no bridge runs', () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory('dshx-effect-communication-missing-')
      const exit = yield* Effect.exit(Effect.provide(Communication, Communication.layer({ stateHome: directory })))
      expect(Exit.isFailure(exit)).toBe(true)
      const failure = yield* Effect.flip(Effect.provide(Communication, Communication.layer({ stateHome: directory })))
      expect(failure.operation).toBe('connect')
      expect(failure.cause).toBeDefined()
    }).pipe(Effect.scoped),
  )
})

describe.skipIf(process.platform === 'win32')('HostTerminal', () => {
  const terminalHost = cordisHost('@test/terminal', ctx => ctx.plugin(LocalSubprocessRuntime))
  it.layer(HostTerminal.layer.pipe(Layer.provide(terminalHost)))(layer => {
    layer.effect('resolves executables and reports the terminal environment of the real provider', () =>
      Effect.gen(function* () {
        const terminal = yield* HostTerminal
        expect(yield* terminal.resolveExecutable('node')).toMatch(/node$/)
        expect((yield* terminal.environment).platform).toBe('posix')
        const missing = yield* terminal.resolveExecutable('dshx-missing-program-for-test').pipe(Effect.flip)
        expect(missing.operation).toBe('resolve-executable')
        expect(missing.cause).toBeDefined()
      }),
    )
  })
})

class EchoAdapter extends LlmAdapter {
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const last = options.messages.at(-1)
    const text = last?.role === 'user' ? last.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('') : ''
    if (text === 'fail') {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'echo refused', code: 'echo-refused' } } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: `${options.system ?? ''}:${text}` }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `${options.system ?? ''}:${text}` } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('Llm', () => {
  const llmHost = cordisHost('@test/llm', async ctx => {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['echo'], new EchoAdapter())
  })
  it.layer(Llm.layer.pipe(Layer.provide(llmHost)))(layer => {
    layer.effect('completes a single turn through the registered adapter', () =>
      Effect.gen(function* () {
        const llm = yield* Llm
        expect(yield* llm.complete({ provider: 'echo', model: 'echo-1', system: 'sys', input: 'hello' })).toBe('sys:hello')
        const failure = yield* llm.complete({ provider: 'echo', model: 'echo-1', system: 'sys', input: 'fail' }).pipe(Effect.flip)
        expect(failure.reason).toBe('echo refused')
        expect(Schema.is(Schema.String)(failure.message)).toBe(true)
      }),
    )

    layer.effect('reads a route model info and keeps the lookup failure cause', () =>
      Effect.gen(function* () {
        const llm = yield* Llm
        expect((yield* llm.modelInfo({ provider: 'echo', model: 'echo-1' })).id).toBe('echo-1')
        expect(yield* llm.imagePricing({ provider: 'echo', model: 'echo-1' })).toBeUndefined()
        const failure = yield* llm.modelInfo({ provider: 'missing', model: 'none' }).pipe(Effect.flip)
        expect(failure).toBeInstanceOf(LlmModelInfoFailed)
        expect(failure.cause).toBeDefined()
      }),
    )
  })
})
