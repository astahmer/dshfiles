import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_APPEARANCE, DEFAULT_FONT_STACKS, THEME_PRESETS } from '@dshfiles/plugin-ui/theme/appearance'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { themeApi } from '../src/api.ts'
import { applyThemeCss, readCachedThemeCss, RUNTIME_CACHE_KEY, RUNTIME_STYLE_ID, writeCachedThemeCss } from '../src/runtime-theme.ts'
import { appearanceSettings, UI_STYLES_SETTINGS_NAMESPACE } from '../src/settings.ts'
import { nextAppearance, normaliseAppearance, themeState } from '../src/theme-state.ts'

const patch = readFileSync(join(process.cwd(), 'cordis.patch.yml'), 'utf8')
const fonts = readFileSync(join(process.cwd(), 'src/fonts.css'), 'utf8')

describe('Appearance settings', () => {
  it('lives in the namespace of the Loader row', () => {
    expect(appearanceSettings.namespace).toBe(UI_STYLES_SETTINGS_NAMESPACE)
    expect(patch).toContain(`id: ${UI_STYLES_SETTINGS_NAMESPACE}`)
  })

  it('defaults to the static first-paint theme (warm stone, Geist, Geist Mono)', () => {
    const value = appearanceSettings.schema({})
    expect(normaliseAppearance(value)).toEqual(DEFAULT_APPEARANCE)
    expect(themeState(normaliseAppearance(value), 'light').isDefault).toBe(true)
  })

  it('lists every preset the plugin-ui generator knows', () => {
    for (const preset of THEME_PRESETS) expect(() => appearanceSettings.schema({ preset: preset.id })).not.toThrow()
    expect(() => appearanceSettings.schema({ preset: 'sepia' as never })).toThrow()
  })

  it('refuses overrides outside the AA-tested bounds', () => {
    expect(() => appearanceSettings.schema({ contrast: 0.8 })).toThrow()
    expect(() => appearanceSettings.schema({ greyTint: 0.2 })).toThrow()
    expect(appearanceSettings.schema({ accentHue: 200 }).accentHue).toBe(200)
  })

  it('keeps the runtime font stacks equal to the static fonts.css stacks', () => {
    const flat = fonts.replace(/\s+/gu, ' ')
    expect(flat).toContain(`--dsh-font-family-text-default: ${DEFAULT_FONT_STACKS.text};`)
    expect(flat).toContain(`--dsh-font-family-code-default: ${DEFAULT_FONT_STACKS.code};`)
  })
})

describe('theme_set transitions', () => {
  const start = normaliseAppearance({})

  it('applies a preset and clears overrides it was not given', () => {
    const custom = nextAppearance(start, { accentHue: 20 })
    expect(custom).toMatchObject({ preset: 'warm-stone', accentHue: 20 })
    const moss = nextAppearance(custom, { preset: 'moss' })
    expect(moss).toEqual({ ...DEFAULT_APPEARANCE, preset: 'moss' })
    expect(nextAppearance(custom, { preset: 'moss', contrast: 1.2 })).toEqual({ ...DEFAULT_APPEARANCE, preset: 'moss', contrast: 1.2 })
  })

  it('keeps overrides across a font change and clears one with null', () => {
    const custom = nextAppearance(start, { greyHue: 200, greyTint: 0.01 })
    const fonts = nextAppearance(custom, { interfaceFont: 'system' })
    expect(fonts).toMatchObject({ greyHue: 200, greyTint: 0.01, interfaceFont: 'system' })
    expect(nextAppearance(fonts, { greyHue: null })).not.toHaveProperty('greyHue')
  })

  it('resets to the defaults', () => {
    const custom = nextAppearance(start, { preset: 'high-contrast', interfaceFont: 'system', accentHue: 30 })
    expect(themeState(custom, 'dark').isDefault).toBe(false)
    const reset = nextAppearance(custom, { reset: true })
    expect(reset).toEqual(DEFAULT_APPEARANCE)
    expect(themeState(reset, 'dark')).toMatchObject({ isDefault: true, preset: 'warm-stone', greyHue: 65, accentHue: 270, scheme: 'dark' })
  })

  it('round-trips get → set → reset through the Host settings service', async () => {
    const Tag = Settings.Tag<ReturnType<typeof appearanceSettings.schema>>(UI_STYLES_SETTINGS_NAMESPACE)
    const layer = Settings.layerTest(UI_STYLES_SETTINGS_NAMESPACE, appearanceSettings.schema({}))
    const program = Effect.gen(function* () {
      const settings = yield* Tag
      const set = (input: Parameters<typeof nextAppearance>[1]) =>
        Effect.gen(function* () {
          const snapshot = yield* settings.snapshot
          const next = nextAppearance(normaliseAppearance(snapshot.value), input)
          yield* settings.replace(appearanceSettings.schema(next), snapshot.revision)
          return themeState(normaliseAppearance(yield* settings.get), 'light')
        })
      const before = themeState(normaliseAppearance(yield* settings.get), 'light')
      const changed = yield* set({ preset: 'slate-blue', codeFont: 'system' })
      const serif = yield* set({ readingFont: 'serif' })
      const reset = yield* set({ reset: true })
      return { before, changed, serif, reset }
    })
    const { before, changed, serif, reset } = await Effect.runPromise(program.pipe(Effect.provide(Layer.fresh(layer))))
    expect(before.isDefault).toBe(true)
    expect(before.readingFont).toBe('sans')
    expect(changed).toMatchObject({ preset: 'slate-blue', greyHue: 250, accentHue: 255, codeFont: 'system', isDefault: false })
    expect(serif).toMatchObject({ preset: 'slate-blue', codeFont: 'system', readingFont: 'serif' })
    expect(reset).toEqual(before)
  })
})

describe('theme tools', () => {
  it('binds theme_get (read-only) and theme_set (write, only on request, with a reset path)', () => {
    const { get, set } = themeApi.methods
    expect(get.tool).toMatchObject({ name: 'theme_get', readOnly: true })
    expect(set.tool).toMatchObject({ name: 'theme_set', readOnly: false })
    expect(set.description).toMatch(/only when the user asked/u)
    expect(set.description).toMatch(/reset: true/u)
  })
})

describe('runtime style element', () => {
  class FakeElement {
    id = ''
    textContent: string | null = null
    parentNode: object | null = null
    constructor(readonly tagName: string) {}
    remove() {
      this.parentNode = null
      doc.nodes.delete(this.id)
    }
  }
  const doc = {
    nodes: new Map<string, FakeElement>(),
    getElementById(id: string) {
      return this.nodes.get(id) ?? null
    },
    createElement(tag: string) {
      return new FakeElement(tag.toUpperCase())
    },
    head: {
      append(element: FakeElement) {
        element.parentNode = doc.head
        doc.nodes.set(element.id, element)
      },
    },
  }
  const asDoc = doc as unknown as Parameters<typeof applyThemeCss>[0]

  it('adds, updates and removes one style element', () => {
    applyThemeCss(asDoc, 'a{}')
    expect(doc.getElementById(RUNTIME_STYLE_ID)?.textContent).toBe('a{}')
    applyThemeCss(asDoc, 'b{}')
    expect(doc.nodes.size).toBe(1)
    expect(doc.getElementById(RUNTIME_STYLE_ID)?.textContent).toBe('b{}')
    applyThemeCss(asDoc, '')
    expect(doc.getElementById(RUNTIME_STYLE_ID)).toBeNull()
  })

  it('caches only a non-default theme', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    writeCachedThemeCss('x{}', storage)
    expect(readCachedThemeCss(storage)).toBe('x{}')
    expect(store.has(RUNTIME_CACHE_KEY)).toBe(true)
    writeCachedThemeCss('', storage)
    expect(store.size).toBe(0)
    expect(readCachedThemeCss(undefined)).toBe('')
  })

  it('never throws when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => undefined,
    }
    expect(readCachedThemeCss(broken)).toBe('')
    expect(() => writeCachedThemeCss('x{}', broken)).not.toThrow()
  })
})
