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
  system: AppServicesModel.system,
  notifications: AppServicesModel.notifications,
  environment: AppServicesModel.createEnvironment({ service: () => undefined, on: () => () => {} }),
}

const createPlugin = (
  owner: string,
  host: FakeHost = fakeSlots(),
): { readonly plugin: PluginContext; readonly dispose: () => void; readonly host: FakeHost } => {
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

describe('whenActive', () => {
  it('resolves at once with an active provider', async () => {
    createPlugin('@test/provider').plugin.provide(CounterContract, { count: () => 7 })
    expect((await createPlugin('@test/consumer').plugin.whenActive(CounterContract)).count()).toBe(7)
  })

  it('queues calls made before the provider starts and runs them in order once it does', async () => {
    const consumer = createPlugin('@test/consumer')
    const order: string[] = []
    const first = consumer.plugin.whenActive(CounterContract).then(counter => order.push(`first:${counter.count()}`))
    const second = consumer.plugin.whenActive(CounterContract).then(counter => order.push(`second:${counter.count()}`))
    await flush()
    expect(order).toEqual([])
    BrowserBroker.failContract(CounterContract, new Error('restarting'))
    await flush()
    expect(order).toEqual([])
    createPlugin('@test/provider').plugin.provide(CounterContract, { count: () => 3 })
    await Promise.all([first, second])
    expect(order).toEqual(['first:3', 'second:3'])
  })

  it('rejects when the caller aborts, the timeout passes or the consumer scope ends', async () => {
    const consumer = createPlugin('@test/consumer')
    const controller = new AbortController()
    const aborted = consumer.plugin.whenActive(CounterContract, { signal: controller.signal })
    controller.abort(new Error('closed'))
    await expect(aborted).rejects.toThrow('closed')

    vi.useFakeTimers()
    try {
      const timedOut = consumer.plugin.whenActive(CounterContract, { timeoutMs: 1_000 })
      const rejection = expect(timedOut).rejects.toMatchObject({ name: 'TimeoutError' })
      await vi.advanceTimersByTimeAsync(1_000)
      await rejection
    } finally {
      vi.useRealTimers()
    }

    const pending = consumer.plugin.whenActive(CounterContract)
    consumer.dispose()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    createPlugin('@test/provider').plugin.provide(CounterContract, { count: () => 1 })
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
    expect(
      plugin
        .list(Exporters)
        .get()
        .map(item => item.id),
    ).toEqual(['steady'])
    expect(BrowserBroker.failures.get()).toEqual([
      expect.objectContaining({ owner: '@test/owner', kind: 'registry', id: 'test.exporter', message: 'item broke' }),
    ])
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
    expect(
      plugin
        .list(Exporters)
        .get()
        .map(item => item.id),
    ).toEqual(['gen-1'])
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

describe('system', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('copies through the clipboard and reports a refused write', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await AppServicesModel.system.copy('b:12')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('b:12')
    writeText.mockRejectedValueOnce(new Error('denied'))
    expect(await AppServicesModel.system.copy('b:12')).toBe(false)
  })

  it('downloads string content under the given name', () => {
    const link = { href: '', download: '', click: vi.fn() }
    const blobs: Blob[] = []
    vi.stubGlobal('document', { createElement: () => link })
    const createObjectURL = (blob: Blob): string => {
      blobs.push(blob)
      return 'blob:report'
    }
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    expect(AppServicesModel.system.save({ name: 'report.json', content: '{}', type: 'application/json' })).toBe(true)
    expect(link).toMatchObject({ href: 'blob:report', download: 'report.json' })
    expect(link.click).toHaveBeenCalledTimes(1)
    expect(blobs[0]?.type).toBe('application/json')
  })

  it('opens only http(s) and mailto URLs, without an opener', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    expect(AppServicesModel.system.openExternal('javascript:alert(1)')).toBe(false)
    expect(AppServicesModel.system.openExternal('file:///etc/passwd')).toBe(false)
    expect(AppServicesModel.system.openExternal('not a url')).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(AppServicesModel.system.openExternal('https://example.test/docs')).toBe(true)
    expect(AppServicesModel.system.openExternal('mailto:team@example.test')).toBe(true)
    expect(open.mock.calls).toEqual([
      ['https://example.test/docs', '_blank', 'noopener,noreferrer'],
      ['mailto:team@example.test', '_blank', 'noopener,noreferrer'],
    ])
  })
})

describe('notifications', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stubNotification = (permission: string, requested: unknown = permission) => {
    const shown: { readonly title: string; readonly options: NotificationOptions; onclick: (() => void) | null; readonly close: () => void }[] = []
    class FakeNotification {
      static permission = permission
      static requestPermission = vi.fn(async () => requested)
      onclick: (() => void) | null = null
      readonly close = vi.fn()
      constructor(title: string, options: NotificationOptions) {
        shown.push(Object.assign(this, { title, options }))
      }
    }
    const focus = vi.fn()
    vi.stubGlobal('window', { Notification: FakeNotification, focus })
    return { shown, focus, FakeNotification }
  }

  it('reports unsupported and shows nothing without the Notification API', async () => {
    vi.stubGlobal('window', {})
    expect(AppServicesModel.notifications.permission()).toBe('unsupported')
    expect(await AppServicesModel.notifications.requestPermission()).toBe('unsupported')
    expect(AppServicesModel.notifications.notify({ title: 'Done' })).toBe(false)
  })

  it('never prompts from notify and shows nothing until permission is granted', () => {
    const { shown, FakeNotification } = stubNotification('default')
    expect(AppServicesModel.notifications.notify({ title: 'Done' })).toBe(false)
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled()
    expect(shown).toEqual([])
  })

  it('shows a granted notification and focuses the page before running onClick', () => {
    const { shown, focus } = stubNotification('granted')
    const onClick = vi.fn(() => expect(focus).toHaveBeenCalled())
    expect(AppServicesModel.notifications.notify({ title: 'Turn finished', body: 'Fix the build', tag: 'thread-1', onClick })).toBe(true)
    expect(shown[0]).toMatchObject({ title: 'Turn finished', options: { body: 'Fix the build', tag: 'thread-1' } })
    shown[0]?.onclick?.()
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(shown[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('returns false when the browser refuses to construct a notification', () => {
    class ThrowingNotification {
      static permission = 'granted'
      constructor() {
        throw new TypeError('Illegal constructor')
      }
    }
    vi.stubGlobal('window', { Notification: ThrowingNotification })
    expect(AppServicesModel.notifications.notify({ title: 'Done' })).toBe(false)
  })

  it('resolves the answered permission, or reads it again when the browser resolves nothing', async () => {
    stubNotification('default', 'granted')
    expect(await AppServicesModel.notifications.requestPermission()).toBe('granted')
    stubNotification('denied', undefined)
    expect(await AppServicesModel.notifications.requestPermission()).toBe('denied')
  })
})

describe('environment', () => {
  const hostLocale = (active: string) => {
    let snapshot = { active, locales: [], revision: 0 }
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      switchTo: (id: string) => {
        snapshot = { ...snapshot, active: id, revision: snapshot.revision + 1 }
        for (const listener of listeners) listener()
      },
    }
  }

  it('follows the Host locale with its text direction and keeps one value per locale', () => {
    const locale = hostLocale('en')
    const environment = AppServicesModel.createEnvironment({ service: name => (name === 'locale' ? locale : undefined), on: () => () => {} })
    const seen: string[] = []
    environment.locale.subscribe(() => seen.push(environment.locale.get().id))
    const first = environment.locale.get()
    expect(first).toEqual({ id: 'en', direction: 'ltr' })
    expect(environment.locale.get()).toBe(first)
    locale.switchTo('ar')
    expect(environment.locale.get()).toEqual({ id: 'ar', direction: 'rtl' })
    expect(seen).toEqual(['ar'])
  })

  it('reads appearance from the Host theme and refreshes on theme/change', () => {
    let theme = { active: { colorScheme: 'light' }, fontFamilies: { text: 'Inter', code: 'JetBrains Mono', terminal: 'Menlo' } }
    const listeners = new Set<() => void>()
    const environment = AppServicesModel.createEnvironment({
      service: name => (name === 'theme' ? { getTheme: () => theme } : undefined),
      on: (_event, listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    const changed = vi.fn()
    environment.appearance.subscribe(changed)
    const first = environment.appearance.get()
    expect(first).toEqual({ colorScheme: 'light', fonts: { text: 'Inter', code: 'JetBrains Mono', terminal: 'Menlo' } })
    expect(environment.appearance.get()).toBe(first)
    theme = { ...theme, active: { colorScheme: 'dark' } }
    for (const listener of listeners) listener()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(environment.appearance.get().colorScheme).toBe('dark')
  })

  it('falls back to the page language and a light scheme without Host services', () => {
    const environment = AppServicesModel.createEnvironment({ service: () => undefined, on: () => () => {} })
    expect(environment.locale.get()).toEqual({ id: 'en', direction: 'ltr' })
    expect(environment.appearance.get()).toEqual({ colorScheme: 'light' })
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
    const prefs = StoreModel.define({
      key: '@test/new',
      scope: 'global',
      schema: z.object({ enabled: z.boolean() }),
      initial: { enabled: true },
      from: ['dshx:@test/old'],
    })
    expect(prefs.get()).toEqual({ enabled: false })
  })

  it('keeps a memory store on the page across a reload of the dshx copy, out of browser storage', async () => {
    const schema = z.object({ expanded: z.array(z.string()) })
    const before = StoreModel.define({ key: '@test/tree', scope: 'project', schema, initial: { expanded: [] }, storage: 'memory' })
    before('p1').set({ expanded: ['src'] })
    expect(memory.size).toBe(0)
    vi.resetModules()
    const reloaded: { readonly StoreModel: typeof StoreModel } = await import('../src/client/store.js')
    const after = reloaded.StoreModel.define({ key: '@test/tree', scope: 'project', schema, initial: { expanded: [] }, storage: 'memory' })
    expect(after('p1').get()).toEqual({ expanded: ['src'] })
    expect(after('p2').get()).toEqual({ expanded: [] })
    after('p1').remove()
    expect(before('p1').get()).toEqual({ expanded: [] })
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
    const ctx = {
      effect: (execute: () => () => void) => execute,
      get: (name: string) => (name === 'slots' ? host.slots : undefined),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      parallel: vi.fn(),
      serial: vi.fn(),
      bail: vi.fn(),
      waterfall: vi.fn(),
      locale: { register: () => () => {} },
    }
    created.apply(ctx as never)
    const api = setup.mock.calls[0]?.[0] as { readonly id: string; readonly add: unknown }
    expect(api.id).toBe('@test/acme')
    expect(api.add).toBeTypeOf('function')
  })

  it("reads the environment from the plugin's Cordis services", () => {
    const theme = { getTheme: () => ({ active: { colorScheme: 'dark' }, fontFamilies: { text: 'a', code: 'b', terminal: 'c' } }) }
    const on = vi.fn(() => () => true)
    const runtime = PluginRuntimeModel.create({
      ctx: { get: name => (name === 'theme' ? theme : undefined), on },
      packageId: '@test/acme',
      decorate: component => component,
    })
    const stop = runtime.plugin.environment.appearance.subscribe(() => {})
    expect(runtime.plugin.environment.appearance.get().colorScheme).toBe('dark')
    expect(on).toHaveBeenCalledWith('theme/change', expect.any(Function))
    stop()
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
