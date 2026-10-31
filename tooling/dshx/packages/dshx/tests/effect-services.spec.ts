import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { Context as EffectContext, Effect, Layer } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { defineApi, method } from '../src/api/index.js'
import { Communication, EffectHostServiceError, HostApiClient, PluginStorage, SecretValues, SettingsRead, Subprocess } from '../src/effect/services.js'
import { DshxEffect } from '../src/effect/index.js'
import { createHostApiClient, defineHost } from '../src/host/index.js'
import { createTestHost } from '../src/testing/index.js'
import type { CommunicationClient } from '../src/communication/bridge.js'
import { parseSecretReference } from '../../../../../plugins/@dshfiles/credential-port/src/secret-reference.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const storageContext = async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshx-effect-storage-'))
  roots.push(root)
  const context = new CordisContext()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root })
  await context.plugin(StorageDomain, { backend: 'json' })
  return context
}

const serviceFailure = { _tag: 'EffectHostServiceError' as const }

class CordisContextService extends EffectContext.Service<CordisContextService, { readonly context: CordisContext }>()(
  'dshx/effect/test/CordisContext',
) {}

describe('@dshfiles/dshx/effect/services', () => {
  it('builds the plugin Layer from its actual Cordis setup context', async () => {
    const host = await createTestHost()
    let factoryContext: CordisContext | undefined
    let setupContext: CordisContext | undefined
    const effectPlugin = DshxEffect.plugin({
      layer: context => {
        factoryContext = context
        return Layer.succeed(CordisContextService, { context })
      },
      setup: context =>
        Effect.gen(function* () {
          setupContext = context
          const service = yield* CordisContextService
          if (service.context !== context) return yield* Effect.die(new Error('Layer factory and setup received different Cordis contexts.'))
        }),
    })
    await host.mount(defineHost({ setup: effectPlugin.setup }), { packageId: '@test/effect-layer-factory' })
    expect(factoryContext).toBe(setupContext)
    await host.dispose()
  })

  it('wraps real namespace-scoped durable PluginStorage reads and writes', async () => {
    const context = await storageContext()
    const layer = PluginStorage.layer({ context, namespace: '@test/effect-storage' })
    const program = Effect.gen(function* () {
      const storage = yield* PluginStorage
      yield* storage.set('records/one', { value: 1 })
      return yield* storage.get('records/one')
    })

    await expect(Effect.runPromise(Effect.provide(program, layer))).resolves.toMatchObject({ value: { value: 1 } })
    await expect(Effect.runPromise(Effect.provide(Effect.gen(function* () {
      const storage = yield* PluginStorage
      return yield* storage.set('', 'invalid key')
    }), layer))).rejects.toMatchObject({ ...serviceFailure, service: 'plugin-storage', operation: 'set' })
  })

  it('makes Host API methods Effect calls with the Promise contract unchanged', async () => {
    const host = await createTestHost()
    const statusApi = defineApi({ id: 'status', version: 1, owner: '@test/status', methods: { read: method<void, string>() } })
    await host.mount(
      defineHost({ apis: [DshxEffect.host(statusApi, { read: () => Effect.succeed('ready') })] }),
      { packageId: '@test/status' },
    )
    const promiseClient = createHostApiClient(host.ctx, statusApi, '@test/caller')
    const effectCall = Effect.gen(function* () {
      const client = yield* HostApiClient
      return yield* client.make(statusApi, '@test/caller').read()
    })

    await expect(promiseClient.read()).resolves.toBe('ready')
    await expect(Effect.runPromise(Effect.provide(effectCall, HostApiClient.layer(host.ctx)))).resolves.toBe('ready')
    await host.dispose()
  })

  it('uses the canonical Secret Catalog request type and maps failures without retaining values', async () => {
    const reference = parseSecretReference('secret:TEST_KEY')
    expect(reference).not.toBeNull()
    if (reference === null) throw new Error('The test reference must parse.')
    const resolvedSecret = 'test-only-secret-value'
    const layer = SecretValues.layer({ resolve: async () => resolvedSecret })
    const program = Effect.gen(function* () {
      const values = yield* SecretValues
      return yield* values.resolve({ reference, cwd: null })
    })
    await expect(Effect.runPromise(Effect.provide(program, layer))).resolves.toBe(resolvedSecret)

    const missing = Effect.gen(function* () {
      const values = yield* SecretValues
      return yield* values.resolve({ reference, cwd: null })
    })
    await expect(Effect.runPromise(Effect.provide(missing, SecretValues.layer(undefined)))).rejects.toMatchObject({
      ...serviceFailure,
      service: 'secret-values',
      operation: 'resolve',
    })
  })

  it('wraps an explicit CommunicationClient rather than inventing a Cordis service', async () => {
    const client: CommunicationClient = {
      principal: { kind: 'external', id: 'effect-test' },
      listAgents: async () => [],
      listTopics: async () => [],
      diagnostics: async () => { throw new Error('unused') },
      subscribe: async () => { throw new Error('unused') },
      unsubscribe: async () => { throw new Error('unused') },
      publish: async () => { throw new Error('unused') },
      send: async () => { throw new Error('unused') },
      inbox: async () => { throw new Error('unused') },
      acknowledge: async () => { throw new Error('unused') },
    }
    const readTopics = Effect.gen(function* () {
      const communication = yield* Communication
      return yield* communication.listTopics()
    })
    await expect(Effect.runPromise(Effect.provide(readTopics, Communication.layer(client)))).resolves.toEqual([])

    const failDiagnostics = Effect.gen(function* () {
      const communication = yield* Communication
      return yield* communication.diagnostics()
    })
    await expect(Effect.runPromise(Effect.provide(failDiagnostics, Communication.layer(client)))).rejects.toMatchObject({
      ...serviceFailure,
      service: 'communication',
      operation: 'diagnostics',
    })
  })

  it('types synchronous SettingsScope getter failures at the boundary', async () => {
    const settingsTag = SettingsRead.make<{ readonly enabled: boolean }>('test-settings')
    const layer = settingsTag.layer({ get: () => { throw new Error('not serialized') } })
    const read = Effect.gen(function* () {
      const settings = yield* settingsTag.Tag
      return yield* settings.get()
    })
    await expect(Effect.runPromise(Effect.provide(read, layer))).rejects.toMatchObject({
      ...serviceFailure,
      service: 'settings-read',
      operation: 'get',
    })
  })

  it('terminates and awaits the managed subprocess range when its Scope closes', async () => {
    let terminated = false
    let waited = false
    const handle: SubprocessHandle = {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => { terminated = true },
      waitForExit: async () => {
        waited = true
        return true
      },
    }
    const runtime: Pick<SubprocessRuntime, 'resolveExecutable' | 'terminalEnvironment' | 'spawn' | 'spawnTerminal'> = {
      resolveExecutable: async command => command,
      terminalEnvironment: async () => ({ platform: 'posix' }),
      spawn: (_spec: SubprocessSpawnSpec) => handle,
      spawnTerminal: async () => { throw new Error('unused') },
    }
    const spec: SubprocessSpawnSpec = {
      argv: ['test'],
      cwd: tmpdir(),
      stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
      graceMs: 10,
    }
    const run = Effect.scoped(Effect.gen(function* () {
      const subprocess = yield* Subprocess
      yield* subprocess.spawnScoped(spec)
    }))
    await Effect.runPromise(Effect.provide(run, Subprocess.layer(runtime)))
    expect(terminated).toBe(true)
    expect(waited).toBe(true)
  })

  it('keeps adapter error diagnostics bounded to service and operation', () => {
    expect(new EffectHostServiceError({ service: 'settings-read', operation: 'get' })).not.toHaveProperty('cause')
  })
})
