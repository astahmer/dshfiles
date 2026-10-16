import { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineClient, defineLocale, defineSlot } from '../src/client/index.js'
import type { ClientContext, LocaleDefinition, LocaleKeyOf, PropsLocaleOf } from '../src/client/index.js'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import { ClientContributionModel } from '../src/client/define.js'
import { localeDefinitionParts } from '../src/client/locale.js'
import type { ClientConversationContribution } from '../src/client/types.js'
import { defineConversation } from '../src/conversation/index.js'
import { createClientModule, createClientPlugin } from '../src/client/runtime.js'
import { createSettingsClientRuntime } from '../src/settings/client.js'
import { defineSettings } from '../src/settings/index.js'
import Schema from '@deepseek-ai/schemastery'
import { PROTOCOL_2_COMPATIBILITY } from '../src/compat/protocol-2.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'test.slot': { kind: 'list'; scope: 'root' }
  }
  interface LocaleNamespaceMap {
    'test.native': 'native-label'
  }
}

function conversationContribution(kind = 'review-job'): ClientConversationContribution {
  return defineConversation({
    kind,
    events: {
      'dshx-test/notice': { role: 'start', id: () => kind },
    },
    initial: () => ({ ready: true }),
  }).render(() => null)
}

describe('defineClient', () => {
  it('preserves identity, literals, and the official Context type', () => {
    const original = {
      name: 'literal-client' as const,
      inject: ['slots'] as const,
      setup(ctx: ClientContext) {
        expectTypeOf(ctx).toEqualTypeOf<ClientContext>()
      },
    }
    const definition = defineClient(original)
    expect(definition).toBe(original)
    expectTypeOf(definition.name).toEqualTypeOf<'literal-client'>()
    expectTypeOf(definition.inject).toEqualTypeOf<readonly ['slots']>()
  })

  it('keeps Host and Client session service contracts separate', () => {
    expectTypeOf<Context['sessions']>().toEqualTypeOf<SessionStore>()
    expectTypeOf<Context['sessions']['get']>().toBeFunction()
    const definition = defineClient({
      inject: ['sessions'],
      setup(ctx) {
        expectTypeOf(ctx.sessions).toEqualTypeOf<ISessions>()
        expectTypeOf(ctx.sessions.scope).toBeFunction()
        // @ts-expect-error Host-only SessionStore lookups are not part of the Client Session API.
        ctx.sessions.get('session-id')
        // @ts-expect-error Host-only SessionStore creation is not part of the Client Session API.
        ctx.sessions.create('session-id')
      },
    })
    expect(definition.inject).toEqual(['sessions'])
  })

  it('rejects removed Client api declarations at compile time', () => {
    defineClient({
      // @ts-expect-error API capability comes only from retained hooks.
      api: {},
    })
  })

  it('uses official SlotMap props and preserves a Slot contribution', () => {
    const component = (_props: PropsRuntime<'test.slot'>) => null
    const options = { id: 'test-entry', order: 3, component }
    const contribution = defineSlot('test.slot', options)
    expect(contribution).toEqual({})
    expect(ClientContributionModel.parts(contribution)).toEqual({ name: 'test.slot', options: { id: 'test-entry', order: 3 }, component })
    expectTypeOf(contribution).toMatchTypeOf<import('../src/client/types.js').SlotContribution<'test.slot'>>()
    // @ts-expect-error Unknown SlotMap keys must be provided by an official augmentation.
    defineSlot('missing.slot', { component })
  })

  it('defines balanced Locale dictionaries and retains namespace and key types', () => {
    const copy = defineLocale('test.copy', {
      zh: { title: '标题', body: '正文' },
      en: { title: 'Title', body: 'Body' },
    })
    expect(localeDefinitionParts(copy)).toEqual({
      namespace: 'test.copy',
      dictionaries: {
        zh: { title: '标题', body: '正文' },
        en: { title: 'Title', body: 'Body' },
      },
    })
    expectTypeOf<LocaleKeyOf<typeof copy>>().toEqualTypeOf<'title' | 'body'>()
    expectTypeOf<PropsLocaleOf<typeof copy>['t']>().parameter(0).toEqualTypeOf<'title' | 'body' | import('@deepseek-ai/dsh-client-ui-slots').CommonKeyOf>()

    defineLocale('test.missing-key', {
      zh: { title: '标题', body: '正文' },
      // @ts-expect-error Every shipped locale must expose exactly the same keys.
      en: { title: 'Title' },
    })
    defineLocale('test.extra-locale', {
      zh: { title: '标题' },
      en: { title: 'Title' },
      // @ts-expect-error Only LocaleId keys are accepted.
      fr: { title: 'Titre' },
    })
    defineLocale('test.invalid-value', {
      zh: { title: '标题' },
      // @ts-expect-error Locale values must be strings.
      en: { title: 1 },
    })
  })
})
describe('Client runtime adapter', () => {
  it('applies definition name, inject normalization, and async setup', async () => {
    const setup = vi.fn(async (ctx: Context) => ctx)
    const context = {} as Context
    const plugin = createClientPlugin(
      { name: 'explicit-client', inject: ['remote', 'remote', 'slots'], setup },
      {
        packageId: '@test/plugin',
        logicalName: 'logical-client',
        sourceFile: '/project/src/client.tsx',
      },
    )
    expect(plugin.name).toBe('explicit-client')
    expect(plugin.inject).toEqual(['remote', 'slots'])
    await plugin.apply(context)
    // setup receives the component decorator and the package metadata, so an
    // imperatively registered component can still read this package's API
    // context through useApi().
    expect(setup).toHaveBeenCalledWith(context, expect.any(Function), {
      packageId: '@test/plugin',
      logicalName: 'logical-client',
      sourceFile: '/project/src/client.tsx',
    })
  })

  it('passes a decorator that returns a component using the API context', async () => {
    const decorateCalls: unknown[] = []
    const setup = vi.fn((_ctx: Context, decorate: (component: unknown) => unknown) => {
      decorateCalls.push(decorate(() => null))
    })
    const plugin = createClientPlugin({ inject: ['remote', 'slots'], setup }, { packageId: '@test/plugin' })
    await plugin.apply({} as Context)
    expect(decorateCalls).toHaveLength(1)
    expect(typeof decorateCalls[0]).toBe('function')
  })

  it('registers Slots in order before setup and adds the slots dependency once', () => {
    const calls: string[] = []
    const first = defineSlot('test.slot', { id: 'first', component: () => null })
    const second = defineSlot('test.slot', { id: 'second', component: () => null })
    const plugin = createClientPlugin(
      {
        inject: ['remote', 'slots'],
        slots: [first, second],
        setup() {
          calls.push('setup')
        },
      },
      {
        packageId: '@test/plugin',
        sourceFile: '/project/src/client.tsx',
      },
    )
    expect(plugin.inject).toEqual(['remote', 'slots'])
    const registered: unknown[] = []
    const ctx = new Context()
    ctx.provide('slots', {
      inject(name: string, register: () => unknown) {
        calls.push(`inject:${name}`)
        return register()
      },
      register(options: { readonly id?: string }, component: unknown) {
        calls.push(`register:${String(options.id)}`)
        registered.push({ options, component })
        return vi.fn()
      },
    })
    plugin.apply(ctx)
    expect(calls).toEqual(['inject:test.slot', 'register:first', 'inject:test.slot', 'register:second', 'setup'])
    expect(registered).toHaveLength(2)
  })

  it('registers Locale effects before Slots and setup, auto-injects locale, and normalizes a Locale handle', () => {
    const calls: string[] = []
    const dispose = vi.fn()
    const copy = defineLocale('test.copy', {
      zh: { title: '标题' },
      en: { title: 'Title' },
    })
    const component = (_props: PropsRuntime<'test.slot'> & PropsLocaleOf<typeof copy>) => null
    const slot = defineSlot('test.slot', { id: 'localized', locale: copy, component })
    const plugin = createClientPlugin(
      {
        inject: ['locale', 'locale'],
        locales: [copy],
        slots: [slot],
        setup() {
          calls.push('setup')
        },
      },
      { packageId: '@test/plugin' },
    )
    expect(plugin.inject).toEqual(['locale', 'slots'])
    const registered: unknown[] = []
    const ctx = new Context()
    const effect = vi.spyOn(ctx, 'effect')
    const registerLocale = vi.fn((namespace: string, dictionaries: unknown) => {
      calls.push(`locale:${namespace}`)
      registered.push({ namespace, dictionaries })
      return dispose
    })
    ctx.provide('locale', { register: registerLocale })
    ctx.provide('slots', {
      inject(name: string, register: () => unknown) {
        calls.push(`inject:${name}`)
        return register()
      },
      register(options: { readonly locale?: string }, registeredComponent: unknown) {
        calls.push(`slot:${String(options.locale)}`)
        registered.push({ options, component: registeredComponent })
        return vi.fn()
      },
    })
    plugin.apply(ctx)
    expect(effect.mock.invocationCallOrder[0]).toBeLessThan(registerLocale.mock.invocationCallOrder[0] ?? 0)
    expect(calls).toEqual(['locale:test.copy', 'inject:test.slot', 'slot:test.copy', 'setup'])
    expect(registered[0]).toEqual({ namespace: 'test.copy', dictionaries: localeDefinitionParts(copy).dictionaries })
    expect(registered[1]).toEqual({ options: { name: 'test.slot', id: 'localized', locale: 'test.copy' }, component })
    expect(dispose).not.toHaveBeenCalled()
  })

  it('preserves native string Locale namespaces for advanced Slot declarations', () => {
    const component = (_props: PropsRuntime<'test.slot'> & PropsLocale<'test.native'>) => null
    const slot = defineSlot('test.slot', { id: 'native', locale: 'test.native', component })
    const register = vi.fn()
    const plugin = createClientPlugin({ slots: [slot] }, { packageId: '@test/plugin' })
    expect(plugin.inject).toEqual(['slots'])
    const ctx = new Context()
    ctx.provide('slots', { inject: (_name: string, apply: () => unknown) => apply(), register })
    plugin.apply(ctx)
    expect(register).toHaveBeenCalledWith({ name: 'test.slot', id: 'native', locale: 'test.native' }, component)
  })

  it('does not inject or register an empty Slot list', () => {
    const plugin = createClientPlugin({ slots: [] }, { packageId: '@test/plugin' })
    expect(plugin.inject).toEqual([])
    const inject = vi.fn()
    const ctx = new Context()
    ctx.provide('slots', { inject, register: vi.fn() })
    plugin.apply(ctx)
    expect(inject).not.toHaveBeenCalled()
  })

  it('injects the runtime services setup(ctx) may touch imperatively', () => {
    const inject = vi.fn()
    const setup = vi.fn((ctx: { slots: { inject: typeof inject }; locale: unknown }) => {
      ctx.slots.inject('test.slot', () => undefined)
      void ctx.locale
    })
    const plugin = createClientPlugin({ setup }, { packageId: '@test/plugin' })

    expect(plugin.inject).toEqual(['locale', 'slots'])
    const ctx = new Context()
    ctx.provide('slots', { inject, register: vi.fn() })
    plugin.apply(ctx)
    expect(setup).toHaveBeenCalledOnce()
    expect(inject).toHaveBeenCalledWith('test.slot', expect.any(Function))
  })

  it('rejects Conversation contributions on a generation without a conversation event registry', () => {
    expect(() =>
      createClientPlugin(
        { conversations: [conversationContribution()] },
        { packageId: '@test/plugin', sourceFile: '/project/src/client.tsx', compatibility: PROTOCOL_2_COMPATIBILITY },
      ),
    ).toThrow(expect.objectContaining({ code: 'DSHX2302', file: '/project/src/client.tsx', hint: expect.stringContaining('slots') }))
  })

  it('does not register an empty Conversation list', () => {
    const setup = vi.fn()
    const plugin = createClientPlugin({ conversations: [], setup }, { packageId: '@test/plugin' })
    expect(plugin.inject).toEqual(['locale', 'slots'])
    plugin.apply({} as Context)
    expect(setup).toHaveBeenCalledOnce()
  })

  it('adds settingsScope from compiler metadata without a Client settings declaration', () => {
    const slot = defineSlot('test.slot', { id: 'settings', component: () => null })
    const registered: unknown[] = []
    const plugin = createClientPlugin({ slots: [slot] }, { packageId: '@test/plugin', settingsCapability: true })
    expect(plugin.inject).toEqual(['slots', 'configForms'])
    const ctx = new Context()
    const get = vi.spyOn(ctx, 'get')
    ctx.provide('configForms', { bind: vi.fn(), describe: vi.fn() })
    ctx.provide('slots', {
      inject: (_name: string, register: () => unknown) => register(),
      register: (_options: unknown, component: unknown) => {
        registered.push(component)
      },
    })
    plugin.apply(ctx)
    expect(get).toHaveBeenCalledWith('configForms')
    expect(registered).toHaveLength(1)
    expect(registered[0]).not.toBe(ClientContributionModel.parts(slot).component)
  })

  it('adds Connection and a lazy API provider from compiler metadata without Client api/apis', async () => {
    const slot = defineSlot('test.slot', { id: 'api-hook', component: () => null })
    const registered: unknown[] = []
    const plugin = createClientPlugin({ inject: ['connection', 'connection'], slots: [slot] }, { packageId: '@test/plugin', apiCapability: true })
    expect(plugin.inject).toEqual(['connection', 'slots'])
    const ctx = new Context()
    const get = vi.spyOn(ctx, 'get')
    ctx.provide('connection', { rpc: { call: vi.fn() } })
    ctx.provide('slots', {
      inject: (_name: string, register: () => unknown) => register(),
      register: (_options: unknown, component: unknown) => {
        registered.push(component)
      },
    })
    await plugin.apply(ctx)
    expect(registered).toHaveLength(1)
    expect(registered[0]).not.toBe(ClientContributionModel.parts(slot).component)
    // Retained-hook contracts bind only when their component invokes useApi().
    expect(get).not.toHaveBeenCalled()
  })

  it('reuses one official bound scope per contract identity', () => {
    const snapshot = { status: 'ready', value: { enabled: true }, base: {}, user: {}, revision: 1, writable: true, mode: 'host' }
    const scope = { getSnapshot: () => snapshot, subscribe: () => () => undefined, set: vi.fn(), unset: vi.fn() }
    const describe = {
      getSnapshot: () => ({ status: 'ready', view: { namespaces: [], writable: true }, error: null }),
      subscribe: () => () => undefined,
      ensure: vi.fn(),
    }
    const get = vi.fn(() => scope)
    const runtime = createSettingsClientRuntime({ get: () => ({ get, describe: () => describe }) })
    const first = defineSettings({ namespace: 'first', schema: Schema.object({ enabled: Schema.boolean() }) })
    const sameShape = defineSettings({ namespace: 'first', schema: first.schema })
    expect(runtime.binding(first)).toBe(runtime.binding(first))
    expect(runtime.binding(sameShape)).not.toBe(runtime.binding(first))
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenNthCalledWith(1, 'first')
  })

  it('falls back from logical name to package id', () => {
    expect(createClientPlugin({}, { packageId: '@test/package', logicalName: 'logical' }).name).toBe('logical')
    expect(createClientPlugin({}, { packageId: '@test/package' }).name).toBe('@test/package')
  })

  it('preserves native Client exports and forwards config', () => {
    const Config = { marker: true }
    const apply = vi.fn(() => 'result')
    const source = { name: 'native-client', inject: { slots: null }, Config, apply }
    const plugin = createClientModule(source, { packageId: '@test/plugin', logicalName: 'logical' })
    const context = {} as Context
    const config = { enabled: true }
    expect(plugin).toMatchObject({ name: 'native-client', inject: source.inject, Config })
    expect(plugin.apply(context, config)).toBe('result')
    expect(apply).toHaveBeenCalledWith(context, config)
  })

  it('prefers a default definition over native named exports', () => {
    const setup = vi.fn()
    const plugin = createClientModule(
      { name: 'native', apply: vi.fn(), default: { name: 'default', setup } },
      {
        packageId: '@test/plugin',
      },
    )
    expect(plugin.name).toBe('default')
    plugin.apply({} as Context)
    expect(setup).toHaveBeenCalledOnce()
  })

  it.each([
    ['empty namespace', '', { zh: { title: '标题' }, en: { title: 'Title' } }],
    ['whitespace namespace', ' test.copy ', { zh: { title: '标题' }, en: { title: 'Title' } }],
    ['non-object dictionaries', 'test.copy', null],
    ['missing locale', 'test.copy', { zh: { title: '标题' } }],
    ['extra locale', 'test.copy', { zh: { title: '标题' }, en: { title: 'Title' }, fr: { title: 'Titre' } }],
    ['non-object dictionary', 'test.copy', { zh: { title: '标题' }, en: [] }],
    ['non-string value', 'test.copy', { zh: { title: '标题' }, en: { title: 1 } }],
    ['empty key', 'test.copy', { zh: { '': '标题' }, en: { '': 'Title' } }],
    ['unbalanced keys', 'test.copy', { zh: { title: '标题', body: '正文' }, en: { title: 'Title' } }],
  ])('rejects a dynamic Locale with %s', (_label, namespace, dictionaries) => {
    const unsafeDefineLocale = defineLocale as (name: unknown, values: unknown) => LocaleDefinition
    const locale = unsafeDefineLocale(namespace, dictionaries)
    expect(() => createClientPlugin({ locales: [locale] }, { packageId: '@test/plugin', sourceFile: '/project/src/client.tsx' })).toThrow(
      expect.objectContaining({ code: 'DSHX2402', file: '/project/src/client.tsx', hint: expect.any(String) }),
    )
  })

  it('rejects duplicate, forged, and copied Locale contributions with stable diagnostics', () => {
    const first = defineLocale('test.copy', { zh: { title: '标题' }, en: { title: 'Title' } })
    const second = defineLocale('test.copy', { zh: { title: '另一个标题' }, en: { title: 'Another title' } })
    expect(() => createClientPlugin({ locales: [first, second] }, { packageId: '@test/plugin' })).toThrow(
      expect.objectContaining({ code: 'DSHX2402', message: expect.stringContaining('duplicate') }),
    )
    expect(() => createClientPlugin({ locales: [{}] }, { packageId: '@test/plugin' })).toThrow(expect.objectContaining({ code: 'DSHX2401' }))
    expect(() => createClientPlugin({ locales: [{ ...first }] }, { packageId: '@test/plugin' })).toThrow(expect.objectContaining({ code: 'DSHX2401' }))
  })

  it.each([
    ['non-object definition', null, 'DSHX2101'],
    ['unknown field', { unknown: true }, 'DSHX2102'],
    ['empty name', { name: '' }, 'DSHX2102'],
    ['invalid inject', { inject: [''] }, 'DSHX2102'],
    ['invalid setup', { setup: true }, 'DSHX2102'],
    ['invalid locales', { locales: {} }, 'DSHX2402'],
    ['invalid Locale contribution', { locales: [{}] }, 'DSHX2401'],
    ['invalid conversations', { conversations: {} }, 'DSHX2302'],
    ['invalid Conversation contribution', { conversations: [{}] }, 'DSHX2301'],
    ['copied Conversation contribution', { conversations: [{ ...conversationContribution() }] }, 'DSHX2301'],
    ['invalid slots', { slots: {} }, 'DSHX2202'],
    ['invalid contribution', { slots: [{}] }, 'DSHX2201'],
  ])('rejects %s with a stable diagnostic', (_label, definition, code) => {
    expect(() =>
      createClientPlugin(definition, {
        packageId: '@test/plugin',
        sourceFile: '/project/src/client.tsx',
      }),
    ).toThrow(expect.objectContaining({ code, file: '/project/src/client.tsx', hint: expect.any(String) }))
  })

  it('rejects a native Client module without apply', () => {
    expect(() =>
      createClientModule(
        { name: 'broken' },
        {
          packageId: '@test/plugin',
          sourceFile: '/project/src/client.tsx',
        },
      ),
    ).toThrow(expect.objectContaining({ code: 'DSHX2101', file: '/project/src/client.tsx' }))
  })
})
