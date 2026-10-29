import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineApi, method } from '../src/api/index.js'
import { ApiProtocolModel } from '../src/api/common.js'
import { registerApi } from '../src/api/host-runtime.js'
import { apiKey, apiRegistry } from '../src/api/registry.js'
import { PluginStorageContract } from '../src/api/storage.js'
import { HostStorageModel } from '../src/client/host-storage.js'
import { PluginStorageModel } from '../src/host/plugin-storage.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** A real Host storage stack (hub, JSON backend, domain form) over a scratch directory. */
const storageHost = async (root?: string) => {
  const directory = root ?? (await mkdtemp(join(tmpdir(), 'dshx-plugin-storage-')))
  if (root === undefined) roots.push(directory)
  const context = new Context()
  await context.plugin(Storage)
  await context.plugin(StorageJson, { root: directory })
  await context.plugin(StorageDomain, { backend: 'json' })
  return { context, directory }
}

describe('pluginStorage', () => {
  it('keeps values per namespace, durably, across a Host restart', async () => {
    const { context, directory } = await storageHost()
    const acme = PluginStorageModel.open(context, '@acme/plugin')
    const other = PluginStorageModel.open(context, '@other/plugin')
    await acme.set('drafts/a', { text: 'hello' })
    await other.set('drafts/a', 1)
    expect((await acme.get('drafts/a'))?.value).toEqual({ text: 'hello' })
    expect((await other.get('drafts/a'))?.value).toBe(1)
    expect(await acme.get('missing')).toBeUndefined()

    const restarted = await storageHost(directory)
    expect((await PluginStorageModel.open(restarted.context, '@acme/plugin').get('drafts/a'))?.value).toEqual({ text: 'hello' })
  })

  it('lists one prefix in key order, a page at a time', async () => {
    const { context } = await storageHost()
    const storage = PluginStorageModel.open(context, '@acme/plugin')
    for (const key of ['b/2', 'a/1', 'b/1', 'b/3', 'c/1']) await storage.set(key, key)
    const first = await storage.list({ prefix: 'b/', limit: 2 })
    expect(first.entries.map(entry => entry.key)).toEqual(['b/1', 'b/2'])
    expect(first.cursor).toBe('b/2')
    const second = await storage.list({ prefix: 'b/', limit: 2, cursor: first.cursor ?? undefined })
    expect(second.entries.map(entry => entry.key)).toEqual(['b/3'])
    expect(second.cursor).toBeNull()
    expect((await storage.list()).entries).toHaveLength(5)
  })

  it('deletes a key once and refuses values and namespaces it cannot store', async () => {
    const { context } = await storageHost()
    const storage = PluginStorageModel.open(context, '@acme/plugin')
    await storage.set('k', true)
    expect(await storage.delete('k')).toBe(true)
    expect(await storage.delete('k')).toBe(false)
    await expect(storage.set('k', 'x'.repeat(300 * 1024))).rejects.toThrow('at most')
    await expect(storage.set('k', () => 1)).rejects.toThrow()
    expect(() => PluginStorageModel.open(context, 'bad namespace')).toThrow()
  })

  it('reports a Host without the storage domain row with a recovery hint', async () => {
    const storage = PluginStorageModel.open(new Context(), '@acme/plugin')
    await expect(storage.get('k')).rejects.toMatchObject({ code: 'storage-unavailable', message: expect.stringContaining('restart DSH') })
  })
})

/** A Host whose real storage stack sits behind a stub Connection, so the registry leader serves the storage API. */
const leadingHost = async () => {
  const { context } = await storageHost()
  const routes = new Map<string, ConnectionFetchRoute>()
  const connection = {
    fetch: {
      register: (route: ConnectionFetchRoute) => {
        routes.set(route.path, route)
        return async () => void routes.delete(route.path)
      },
    },
  }
  const host = {
    get: (name: string) => (name === 'connection' ? connection : context.get(name)),
    on: context.on.bind(context),
    effect: () => undefined,
  }
  Object.assign(host, { root: host })
  const probe = defineApi({ id: 'probe', version: 1, owner: '@acme/plugin', methods: { ping: method({ output: z.literal('pong') }) } })
  await registerApi(host as never, '@acme/plugin', probe.host({ ping: () => 'pong' as const }))
  const registry = apiRegistry(host as never)
  await vi.waitFor(() => expect(registry.apis.has(apiKey(PluginStorageContract.api.owner!, 'storage'))).toBe(true))
  const served = registry.apis.get(apiKey(PluginStorageContract.api.owner!, 'storage'))!
  /** What a browser's Connection RPC reaches: the leader's dispatch of the storage API. */
  const browser = {
    get: (name: string) =>
      name === 'connection'
        ? {
            rpc: {
              call: (_channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) =>
                served.dispatch(endpoint.split('/').at(-1)!, payload as never, signal ?? new AbortController().signal, { kind: 'client' }, undefined),
            },
          }
        : undefined,
  }
  return { context, host, routes, browser }
}

describe('the storage API the registry leader serves', () => {
  it('lets a browser read what the Host half wrote, and publishes each change', async () => {
    const { context, host, routes, browser } = await leadingHost()
    expect(routes.has(ApiProtocolModel.eventsPath)).toBe(true)
    const writes: unknown[] = []
    context.on('domain/changed', change => void writes.push(PluginStorageModel.changeOf(change)))
    await PluginStorageModel.open(host as never, '@acme/plugin').set('prefs', { theme: 'dark' })
    expect(writes).toEqual([{ namespace: '@acme/plugin', key: 'prefs', deleted: false }])

    const storage = HostStorageModel.create({ ctx: browser, namespace: '@acme/plugin', signal: new AbortController().signal })
    expect((await storage.get('prefs'))?.value).toEqual({ theme: 'dark' })
    await storage.set('other', [1, 2])
    expect((await storage.list()).entries.map(entry => entry.key)).toEqual(['other', 'prefs'])
    expect(await storage.delete('other')).toBe(true)
    expect(writes.at(-1)).toEqual({ namespace: '@acme/plugin', key: 'other', deleted: true })
  })

  it('keeps a Host store: initial until ready, then the Host value; writes reach the Host', async () => {
    const { host, browser } = await leadingHost()
    const hostHalf = PluginStorageModel.open(host as never, '@acme/plugin')
    await hostHalf.set('store/layout', { columns: 3 })
    const storage = HostStorageModel.create({ ctx: browser, namespace: '@acme/plugin', signal: new AbortController().signal })
    const layout = storage.store({ key: 'layout', scope: 'global', schema: z.object({ columns: z.number() }), initial: { columns: 1 } })
    expect(layout.get()).toEqual({ columns: 1 })
    await layout.ready
    expect(layout.get()).toEqual({ columns: 3 })

    const seen: unknown[] = []
    layout.subscribe(() => void seen.push(layout.get()))
    layout.set({ columns: 4 })
    expect(seen).toEqual([{ columns: 4 }])
    await vi.waitFor(async () => expect((await hostHalf.get('store/layout'))?.value).toEqual({ columns: 4 }))

    const perSession = storage.store({ key: 'draft', scope: 'session', schema: z.string(), initial: '' })
    perSession('s1').set('hi')
    await vi.waitFor(async () => expect((await hostHalf.get('store/draft/session/s1'))?.value).toBe('hi'))
    layout.remove()
    await vi.waitFor(async () => expect(await hostHalf.get('store/layout')).toBeUndefined())
  })

  it('rejects ready when the browser has no Connection', async () => {
    const storage = HostStorageModel.create({ ctx: { get: () => undefined }, namespace: '@acme/none', signal: new AbortController().signal })
    const store = storage.store({ key: 'x', scope: 'global', schema: z.number(), initial: 0 })
    await expect(store.ready).rejects.toMatchObject({ kind: 'unavailable' })
    expect(store.get()).toBe(0)
  })
})

describe('hostStorage', () => {
  it('reaches the Host from the context defineClientPlugin hands setup', async () => {
    const { PluginRuntimeModel } = await import('../src/client/plugin-runtime.js')
    const { createTestClient } = await import('../src/testing/index.js')
    const client = await createTestClient()
    const api = PluginRuntimeModel.create({ ctx: client.ctx, packageId: '@acme/plugin', decorate: component => component }).plugin
    const store = HostStorageModel.forPlugin(api).store({ key: 'x', scope: 'global', schema: z.number(), initial: 0 })
    // No Connection in this stub: the call is made, and reports it, instead of refusing the context.
    await expect(store.ready).rejects.toMatchObject({ kind: 'unavailable' })
    await client.dispose()
  })
})
