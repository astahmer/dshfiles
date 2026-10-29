// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import * as cordis from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { defineLocale, plural } from '../src/client/index.js'
import type { PropsLocaleOf } from '../src/client/index.js'
import { createClientPlugin } from '../src/client/runtime.js'

type NativeLocaleModule = typeof import('@deepseek-ai/dsh-client-locale/client')

// createClientModuleLoader cannot load this provider: its UI dependencies import CSS
// through Node. The runtime class needs none of them, only cordis and the DOM globals.
const loadNativeLocale = (): NativeLocaleModule => {
  const entry = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-client-locale/client')
  let factory: ((require: (id: string) => unknown) => unknown) | undefined
  runInNewContext(readFileSync(entry, 'utf8'), {
    window: { __ModuleLoader__: { load: (module: { factory: typeof factory }) => (factory = module.factory) } },
    document,
    navigator,
    console,
  })
  if (factory === undefined) throw new Error('The native Locale provider did not supply a lazy factory.')
  // SAFETY: the factory returns the provider's client exports, typed by its declaration file.
  return factory(id => (id === '@deepseek-ai/cordis' ? cordis : {})) as NativeLocaleModule
}

const nativeLocale = loadNativeLocale()

const copy = defineLocale('test.fallback', {
  en: {
    title: 'Title',
    body: 'Body',
    items_one: '{count} item in {folder}',
    items_other: '{count} items in {folder}',
    files_zero: 'No files',
    files_one: 'One file',
    files_other: '{count} files',
  },
  zh: { title: '标题', items_other: '{folder} 中有 {count} 项' },
  fr: { body: 'Corps', items_one: '{count} élément', items_other: '{count} éléments' },
})

const bootLocale = () => {
  const ctx = new cordis.Context()
  const runtime = new nativeLocale.LocaleRuntime(ctx)
  ctx.provide('locale', runtime)
  runtime.addLanguage({ id: 'fr', label: 'Français', fallback: 'en' })
  createClientPlugin({ locales: [copy] }, { packageId: '@test/plugin' }).apply(ctx)
  const t: PropsLocaleOf<typeof copy>['t'] = runtime.bind('test.fallback')
  // The provider's apply() mirrors the active locale onto <html lang>; this test boots only its runtime class.
  runtime.subscribe(() => {
    const active = runtime.getSnapshot().active
    document.documentElement.lang = active === 'zh' ? 'zh-CN' : active
  })
  return { selectLocale: (locale: string) => runtime.setLocale(locale), t }
}

describe('defineLocale English fallback', () => {
  it('fills partial locales from English before registering with the native provider', () => {
    const { selectLocale, t } = bootLocale()
    selectLocale('zh')
    expect(t('title')).toBe('标题')
    expect(t('body')).toBe('Body')
    selectLocale('fr')
    expect(t('title')).toBe('Title')
    expect(t('body')).toBe('Corps')
    selectLocale('en')
    expect(t('title')).toBe('Title')
  })

  it('registers an English-only definition as complete zh text', () => {
    const englishOnly = defineLocale('test.english-only', { en: { title: 'Title' } })
    const ctx = new cordis.Context()
    const runtime = new nativeLocale.LocaleRuntime(ctx)
    ctx.provide('locale', runtime)
    createClientPlugin({ locales: [englishOnly] }, { packageId: '@test/plugin' }).apply(ctx)
    runtime.setLocale('zh')
    expect(runtime.bind('test.english-only')('title')).toBe('Title')
  })
})

describe('plural', () => {
  it('picks the English plural category and interpolates count and params', () => {
    const { selectLocale, t } = bootLocale()
    selectLocale('en')
    expect(plural(t, 'items', 1, { folder: 'src' })).toBe('1 item in src')
    expect(plural(t, 'items', 4, { folder: 'src' })).toBe('4 items in src')
    expect(plural(t, 'items', 0, { folder: 'src' })).toBe('0 items in src')
    expect(plural(t, 'files', 0)).toBe('No files')
    expect(plural(t, 'files', 1)).toBe('One file')
    expect(plural(t, 'files', 2)).toBe('2 files')
  })

  it('uses Chinese plural rules, which only select other', () => {
    const { selectLocale, t } = bootLocale()
    selectLocale('zh')
    expect(plural(t, 'items', 1, { folder: 'src' })).toBe('src 中有 1 项')
    expect(plural(t, 'files', 0)).toBe('No files')
    expect(plural(t, 'files', 1)).toBe('1 files')
  })

  it('uses the additional locale variants and falls back to English text', () => {
    const { selectLocale, t } = bootLocale()
    selectLocale('fr')
    expect(plural(t, 'items', 1)).toBe('1 élément')
    expect(plural(t, 'items', 3)).toBe('3 éléments')
    expect(plural(t, 'files', 1)).toBe('One file')
  })

  it('accepts only plural base keys', () => {
    const { t } = bootLocale()
    // @ts-expect-error title has no _other variant.
    plural(t, 'title', 1)
    // @ts-expect-error Variant keys are not base keys.
    plural(t, 'items_one', 1)
  })
})
