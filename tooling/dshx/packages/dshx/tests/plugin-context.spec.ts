import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import { createElement } from 'react'
import { BrowserBroker, type Live } from '../src/client/broker.js'
import { AppServicesModel, Command, Dialogs, type DialogsService } from '../src/client/app-services.js'
import { PluginHooksModel } from '../src/client/hooks.js'
import { PluginContextModel, type NativeSlots, type PluginContext } from '../src/client/plugin-context.js'
import { PluginRuntimeModel } from '../src/client/plugin-runtime.js'
import { Panel, PluginDetailBadge, PluginDetailSection, SettingsSection } from '../src/client/registries.js'
import { StoreModel } from '../src/client/store.js'
import { SettingsSearchEntriesModel } from '../src/settings/section-entries.js'
import { defineClientPlugin } from '../src/sdk/client.js'
import { createClientPlugin } from '../src/client/runtime.js'

const nodeRequire = createRequire(import.meta.url)
const { renderToStaticMarkup } = nodeRequire('react-dom/server') as { renderToStaticMarkup(element: unknown): string }

const flush = () => new Promise<void>(resolve => queueMicrotask(resolve))

interface FakeHost {
  readonly slots: NativeSlots
  readonly registered: { readonly name: string; readonly options: Record<string, unknown>; readonly component: unknown; disposed: boolean }[]
}

const fakeSlots = (): FakeHost => {
  const registered: FakeHost['registered'] = []
  return {
    registered,
    slots: {
      inject: (_name, register) => register(),
      register: (options, component) => {
        const entry = { name: String(options.name), options, component, disposed: false }
        registered.push(entry)
        return () => {
          entry.disposed = true
        }
      },
    },
  }
}

const services = {
  dialogs: AppServicesModel.dialogs,
  toast: AppServicesModel.toast,
  commands: AppServicesModel.createCommands(() => undefined),
  layout: AppServicesModel.createLayout(() => undefined),
}

const createPlugin = (owner: string, host: FakeHost = fakeSlots()): { readonly plugin: PluginContext; readonly dispose: () => void; readonly host: FakeHost } => {
  const scope = PluginContextModel.createScope()
  const plugin = PluginContextModel.create({ owner, scope, slots: () => host.slots, decorate: component => component, services })
  return { plugin, dispose: () => scope.dispose(), host }
}

interface Counter {
  count(): number
}

const CounterContract = BrowserBroker.defineContract<Counter>('test.counter')
const Exporters = BrowserBroker.defineRegistry<{ readonly id: string; readonly title: string }>('test.exporter')

beforeEach(() => BrowserBroker.reset())
afterEach(() => BrowserBroker.reset())

describe('contracts', () => {
  it('moves pending → active → disabled as a provider starts and stops', () => {
    const provider = createPlugin('@test/provider')
    const consumer = createPlugin('@test/consumer')
    const live = consumer.plugin.use(CounterContract)
    const seen: Live<Counter>['status'][] = [live.get().status]
    live.subscribe(() => seen.push(live.get().status))

    provider.plugin.provide(CounterContract, { count: () => 42 })
    const active = live.get()
    expect(active.status === 'active' && active.value.count()).toBe(42)
    expect(active.status === 'active' && active.generation).toBe(1)

    provider.dispose()
    expect(live.get()).toEqual({ status: 'inactive', reason: 'disabled' })
    expect(seen).toEqual(['pending', 'active', 'inactive'])
    expect(consumer.plugin.use(CounterContract)).toBe(live)
  })

  it('counts a restart as a new generation', () => {
    const first = createPlugin('@test/provider')
    first.plugin.provide(CounterContract, { count: () => 1 })
    first.dispose()
    const second = createPlugin('@test/provider')
    second.plugin.provide(CounterContract, { count: () => 2 })
    const live = BrowserBroker.live(CounterContract).get()
    expect(live.status === 'active' && live.generation).toBe(2)
  })

  it('refuses a second provider and a provider outside the declared owner', () => {
    createPlugin('@test/one').plugin.provide(CounterContract, { count: () => 1 })
    expect(() => createPlugin('@test/two').plugin.provide(CounterContract, { count: () => 2 })).toThrow(/already provided by @test\/one/u)
    const Owned = BrowserBroker.defineContract<Counter>('test.owned', { owner: '@test/owner' })
    expect(() => createPlugin('@test/other').plugin.provide(Owned, { count: () => 0 })).toThrow(/belongs to @test\/owner/u)
    expect(() => BrowserBroker.defineContract('Bad Id')).toThrow(/lowercase/u)
  })

  it('reports a failed provider as inactive and failed', () => {
    BrowserBroker.failContract(CounterContract, new Error('boom'))
    expect(BrowserBroker.live(CounterContract).get()).toMatchObject({ status: 'inactive', reason: 'failed' })
  })

  it('keeps the value type of the token', () => {
    const live = createPlugin('@test/consumer').plugin.use(CounterContract).get()
    if (live.status === 'active') expectTypeOf(live.value).toEqualTypeOf<Counter>()
  })
})

describe('registries', () => {
  it('lists items from every plugin and withdraws them with their scope', () => {
    const owner = createPlugin('@test/owner')
    const contributor = createPlugin('@test/contributor')
    const list = owner.plugin.list(Exporters)
    contributor.plugin.add(Exporters, { id: 'gist', title: 'Gist' })
    const remove = owner.plugin.add(Exporters, { id: 'file', title: 'File' })
    expect(list.get().map(item => item.id)).toEqual(['gist', 'file'])
    remove()
    contributor.dispose()
    expect(list.get()).toEqual([])
  })

  it('recomputes a reactive item when a tracked source changes and withdraws it on undefined', async () => {
    const plugin = createPlugin('@test/owner').plugin
    const enabled = PluginContextModel.signal(true)
    plugin.add(Exporters, track => (track(enabled) ? { id: 'gist', title: 'Gist' } : undefined))
    expect(plugin.list(Exporters).get()).toHaveLength(1)
    enabled.set(false)
    await flush()
    expect(plugin.list(Exporters).get()).toHaveLength(0)
    enabled.set(true)
    await flush()
    expect(plugin.list(Exporters).get()).toHaveLength(1)
  })

  it('isolates a throwing reactive item to that item', async () => {
    const plugin = createPlugin('@test/owner').plugin
    const broken = PluginContextModel.signal(false)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    plugin.add(Exporters, track => {
      if (track(broken)) throw new Error('item broke')
      return { id: 'flaky', title: 'Flaky' }
    })
    plugin.add(Exporters, { id: 'steady', title: 'Steady' })
    broken.set(true)
    await flush()
    expect(plugin.list(Exporters).get().map(item => item.id)).toEqual(['steady'])
    expect(BrowserBroker.failures.get()).toEqual([expect.objectContaining({ owner: '@test/owner', kind: 'registry', id: 'test.exporter', message: 'item broke' })])
  })

  it('mounts a Panel into the main and sidebar slots and removes both on dispose', () => {
    const { plugin, dispose, host } = createPlugin('@test/panels')
    plugin.add(Panel, { id: 'acme', title: 'Acme', component: () => null })
    expect(host.registered.map(entry => entry.name)).toEqual(['main', 'sidebar.panellist'])
    expect(plugin.list(Panel).get()).toHaveLength(1)
    dispose()
    expect(host.registered.every(entry => entry.disposed)).toBe(true)
    expect(plugin.list(Panel).get()).toHaveLength(0)
  })

  it('publishes settings search entries as section metadata', () => {
    const { plugin, host, dispose } = createPlugin('@test/settings')
    plugin.add(SettingsSection, { id: 'acme', title: 'Acme', component: () => null, entries: [{ id: 'sync', title: 'Sync' }] })
    expect(host.registered[0]?.options).toMatchObject({ name: 'settings.section', id: 'acme', registrant: '@test/settings' })
    expect(SettingsSearchEntriesModel.current().get('acme')).toEqual([{ id: 'sync', title: 'Sync' }])
    dispose()
    expect(SettingsSearchEntriesModel.current().has('acme')).toBe(false)
  })

  it('mounts Plugins page badges and sections into their detail slots', () => {
    const { plugin, host } = createPlugin('@test/plugins-page')
    plugin.add(PluginDetailBadge, { id: 'failures', component: () => null })
    plugin.add(PluginDetailSection, { id: 'failures', order: 5, component: () => null })
    expect(host.registered.map(entry => [entry.name, entry.options.id, entry.options.order])).toEqual([
      ['plugins.detail.badge', 'failures', 100],
      ['plugins.detail.section', 'failures', 5],
    ])
  })

  it('reports an invalid native item instead of throwing from add', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { plugin } = createPlugin('@test/panels')
    expect(() => plugin.add(Panel, { id: 'conversation', title: 'Taken', component: () => null })).not.toThrow()
    expect(plugin.list(Panel).get()).toHaveLength(0)
    expect(BrowserBroker.failures.get()[0]).toMatchObject({ id: 'dshx.panel:conversation', message: expect.stringMatching(/reserved/u) })
  })
})

describe('keyed', () => {
  it('runs per key and withdraws the previous run on change', () => {
    const plugin = createPlugin('@test/owner').plugin
    const provider = createPlugin('@test/provider')
    const cleanups: string[] = []
    plugin.keyed(plugin.use(CounterContract), (live, child) => {
      if (live.status !== 'active') return
      child.add(Exporters, { id: `gen-${live.generation}`, title: 'x' })
      return () => cleanups.push(`gen-${live.generation}`)
    })
    expect(plugin.list(Exporters).get()).toEqual([])
    provider.plugin.provide(CounterContract, { count: () => 1 })
    expect(plugin.list(Exporters).get().map(item => item.id)).toEqual(['gen-1'])
    provider.dispose()
    expect(plugin.list(Exporters).get()).toEqual([])
    expect(cleanups).toEqual(['gen-1'])
  })
})

describe('services', () => {
  it('runs a contributed command by id and refuses a disabled one', async () => {
    const plugin = createPlugin('@test/owner').plugin
    const run = vi.fn()
    plugin.add(Command, { id: '@test/owner.go', title: 'Go', run })
    plugin.add(Command, { id: '@test/owner.off', title: 'Off', enabled: false, run })
    expect(plugin.commands.run('@test/owner.go')).toBe(true)
    expect(plugin.commands.run('@test/owner.off')).toBe(false)
    expect(plugin.commands.run('missing')).toBe(false)
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('routes dialogs to the provider while it is active', async () => {
    const provided: DialogsService = { ...AppServicesModel.browserDialogs, confirm: async () => true }
    const provider = createPlugin('@test/dialogs')
    provider.plugin.provide(Dialogs, provided)
    expect(await createPlugin('@test/owner').plugin.dialogs.confirm({ title: 'Sure?' })).toBe(true)
  })
})

describe('stores', () => {
  const memory = new Map<string, string>()
  beforeEach(() => {
    memory.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads initial, writes, notifies and removes a global store', () => {
    const prefs = StoreModel.define({ key: '@test/prefs', scope: 'global', schema: z.object({ enabled: z.boolean() }), initial: { enabled: true } })
    const listener = vi.fn()
    prefs.subscribe(listener)
    expect(prefs.get()).toEqual({ enabled: true })
    prefs.update(current => ({ enabled: !current.enabled }))
    expect(prefs.get()).toEqual({ enabled: false })
    expect(listener).toHaveBeenCalledTimes(1)
    prefs.remove()
    expect(prefs.get()).toEqual({ enabled: true })
  })

  it('keeps one value per session and falls back to initial on an invalid stored value', () => {
    const drafts = StoreModel.define({ key: '@test/draft', scope: 'session', schema: z.string(), initial: '' })
    drafts('a').set('hello')
    expect(drafts('a').get()).toBe('hello')
    expect(drafts('b').get()).toBe('')
    memory.set('dshx:@test/draft:session:b', '42')
    expect(drafts('b').get()).toBe('')
  })

  it('imports a value from an earlier key once', () => {
    memory.set('dshx:@test/old', JSON.stringify({ enabled: false }))
    const prefs = StoreModel.define({ key: '@test/new', scope: 'global', schema: z.object({ enabled: z.boolean() }), initial: { enabled: true }, from: ['dshx:@test/old'] })
    expect(prefs.get()).toEqual({ enabled: false })
  })
})

describe('React', () => {
  it('gives a bound component the context of the plugin that bound it', () => {
    const plugin = createPlugin('@test/owner').plugin
    const Label = () => createElement('span', null, PluginHooksModel.usePlugin().id)
    const Bound = plugin.bind(PluginHooksModel.provide(Label, plugin))
    expect(renderToStaticMarkup(createElement(Bound))).toBe('<span>@test/owner</span>')
  })

})

describe('plugin entry points', () => {
  it('hands defineClientPlugin setup the plugin context', () => {
    const setup = vi.fn()
    const definition = defineClientPlugin({ id: 'acme', setup })
    const created = createClientPlugin(definition, { packageId: '@test/acme' })
    const host = fakeSlots()
    const ctx = { effect: (execute: () => () => void) => execute, get: (name: string) => (name === 'slots' ? host.slots : undefined), on: vi.fn(), once: vi.fn(), emit: vi.fn(), parallel: vi.fn(), serial: vi.fn(), bail: vi.fn(), waterfall: vi.fn(), locale: { register: () => () => {} } }
    created.apply(ctx as never)
    const api = setup.mock.calls[0]?.[0] as { readonly id: string; readonly add: unknown }
    expect(api.id).toBe('@test/acme')
    expect(api.add).toBeTypeOf('function')
  })

  it('builds a scope-bound runtime whose decorator provides the plugin context', () => {
    const disposers: (() => void)[] = []
    const runtime = PluginRuntimeModel.create({
      ctx: { effect: execute => disposers.push(execute()), get: () => undefined },
      packageId: '@test/acme',
      decorate: component => component,
    })
    const Label = () => createElement('b', null, PluginHooksModel.usePlugin().id)
    expect(renderToStaticMarkup(createElement(runtime.decorate(Label)))).toBe('<b>@test/acme</b>')
    runtime.plugin.provide(CounterContract, { count: () => 1 })
    for (const dispose of disposers) dispose()
    expect(BrowserBroker.live(CounterContract).get()).toEqual({ status: 'inactive', reason: 'disabled' })
  })
})
