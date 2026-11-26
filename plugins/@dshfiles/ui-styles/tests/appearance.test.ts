import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_APPEARANCE, DEFAULT_FONT_STACKS, SCENE_FRAME_RATE, THEME_PRESETS } from '@dshfiles/plugin-ui/theme/appearance'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { Effect, Layer } from 'effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'
import { themeApi } from '../src/api.ts'
import { RuntimeTheme, RUNTIME_CACHE_KEY, RUNTIME_STYLE_ID } from '../src/runtime-theme.ts'
import { appearanceSettings, UI_STYLES_SETTINGS_NAMESPACE } from '../src/settings.ts'
import { InvalidThemeDefinition, ThemeStateModel } from '../src/theme-state.ts'

const patch = readFileSync(join(process.cwd(), 'cordis.patch.yml'), 'utf8')
const fonts = readFileSync(join(process.cwd(), 'src/fonts.css'), 'utf8')
/** The defaults as normalised from storage: no saved theme in use, none saved. */
const STORED_DEFAULT = {
  ...DEFAULT_APPEARANCE,
  readingBlur: 0,
  readingTint: 0,
  sceneFrameRate: SCENE_FRAME_RATE.default,
  customTheme: '',
  customThemes: [],
}

describe('Appearance settings', () => {
  it('lives in the namespace of the Loader row', () => {
    expect(appearanceSettings.namespace).toBe(UI_STYLES_SETTINGS_NAMESPACE)
    expect(patch).toContain(`id: ${UI_STYLES_SETTINGS_NAMESPACE}`)
  })

  it('defaults to the static first-paint theme (warm stone, Geist, Geist Mono)', () => {
    const value = appearanceSettings.schema({})
    expect(ThemeStateModel.normaliseAppearance(value)).toEqual(STORED_DEFAULT)
    expect(ThemeStateModel.themeState(ThemeStateModel.normaliseAppearance(value), 'light').isDefault).toBe(true)
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
  const start = ThemeStateModel.normaliseAppearance({})

  it('applies a preset and clears overrides it was not given', () => {
    const custom = ThemeStateModel.nextAppearance(start, { accentHue: 20 })
    expect(custom).toMatchObject({ preset: 'warm-stone', accentHue: 20 })
    const moss = ThemeStateModel.nextAppearance(custom, { preset: 'moss' })
    expect(moss).toEqual({ ...STORED_DEFAULT, preset: 'moss' })
    expect(ThemeStateModel.nextAppearance(custom, { preset: 'moss', contrast: 1.2 })).toEqual({ ...STORED_DEFAULT, preset: 'moss', contrast: 1.2 })
  })

  it('keeps overrides across a font change and clears one with null', () => {
    const custom = ThemeStateModel.nextAppearance(start, { greyHue: 200, greyTint: 0.01 })
    const fonts = ThemeStateModel.nextAppearance(custom, { interfaceFont: 'system' })
    expect(fonts).toMatchObject({ greyHue: 200, greyTint: 0.01, interfaceFont: 'system' })
    expect(ThemeStateModel.nextAppearance(fonts, { greyHue: null })).not.toHaveProperty('greyHue')
  })

  it('resets to the defaults', () => {
    const custom = ThemeStateModel.nextAppearance(start, { preset: 'high-contrast', interfaceFont: 'system', accentHue: 30 })
    expect(ThemeStateModel.themeState(custom, 'dark').isDefault).toBe(false)
    const reset = ThemeStateModel.nextAppearance(custom, { reset: true })
    expect(reset).toEqual(STORED_DEFAULT)
    expect(ThemeStateModel.themeState(reset, 'dark')).toMatchObject({ isDefault: true, preset: 'warm-stone', greyHue: 65, accentHue: 270, scheme: 'dark' })
  })

  it('round-trips get → set → reset through the Host settings service', async () => {
    const Tag = Settings.Tag<ReturnType<typeof appearanceSettings.schema>>(UI_STYLES_SETTINGS_NAMESPACE)
    const layer = Settings.layerTest(UI_STYLES_SETTINGS_NAMESPACE, appearanceSettings.schema({}))
    const program = Effect.gen(function* () {
      const settings = yield* Tag
      const set = (input: Parameters<typeof ThemeStateModel.nextAppearance>[1]) =>
        Effect.gen(function* () {
          const snapshot = yield* settings.snapshot
          const next = ThemeStateModel.nextAppearance(ThemeStateModel.normaliseAppearance(snapshot.value), input)
          yield* settings.replace(appearanceSettings.schema({ ...next, customThemes: [...(next.customThemes ?? [])] }), snapshot.revision)
          return ThemeStateModel.themeState(ThemeStateModel.normaliseAppearance(yield* settings.get), 'light')
        })
      const before = ThemeStateModel.themeState(ThemeStateModel.normaliseAppearance(yield* settings.get), 'light')
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

const role = (bg: string, text: string, accent: string) => ({
  bg,
  panel: bg,
  raised: bg,
  selected: bg,
  line: bg,
  border: bg,
  borderStrong: bg,
  strong: text,
  faint: text,
  muted: text,
  text,
  accent,
  onAccent: bg,
  success: text,
  warning: text,
  danger: text,
  info: text,
})
const NORD = { id: 'nord', label: 'Nord', dark: { colours: role('#2e3440', '#eceff4', '#88c0d0') } }

describe('saved themes', () => {
  const start = ThemeStateModel.normaliseAppearance({})

  it('saves a theme, switches to it live, and replaces it when saved again', () => {
    const withOverride = ThemeStateModel.nextAppearance(start, { accentHue: 20 })
    const saved = ThemeStateModel.defineTheme(withOverride, { theme: NORD })
    expect(saved).toMatchObject({ customTheme: 'nord' })
    expect(saved).not.toHaveProperty('accentHue')
    const state = ThemeStateModel.themeState(saved, 'dark')
    expect(state).toMatchObject({ customTheme: 'nord', isDefault: false, contrastWarnings: [] })
    expect(state.savedThemes).toEqual([{ id: 'nord', label: 'Nord', description: '', schemes: ['dark'], backdrop: false }])
    const renamed = ThemeStateModel.defineTheme(saved, { theme: { ...NORD, label: 'Nord Aurora' } })
    expect(ThemeStateModel.themeState(renamed, 'dark').savedThemes.map(theme => theme.label)).toEqual(['Nord Aurora'])
  })

  it('keeps the current theme when saving with apply: false, and returns to a preset with theme_set', () => {
    const kept = ThemeStateModel.defineTheme(start, { theme: NORD, apply: false })
    expect(kept.customTheme).toBe('')
    const using = ThemeStateModel.nextAppearance(kept, { customTheme: 'nord' })
    expect(using.customTheme).toBe('nord')
    expect(ThemeStateModel.nextAppearance(using, { preset: 'moss' })).toMatchObject({ preset: 'moss', customTheme: '' })
    expect(ThemeStateModel.nextAppearance(using, { customTheme: null }).customTheme).toBe('')
    // Reset keeps the saved themes, so the user can come back to them.
    expect(ThemeStateModel.nextAppearance(using, { reset: true }).customThemes).toHaveLength(1)
  })

  it('refuses an invalid theme or an unknown saved theme with every problem', () => {
    expect(() => ThemeStateModel.defineTheme(start, { theme: { ...NORD, id: 'dracula' } as never })).toThrow(InvalidThemeDefinition)
    expect(() => ThemeStateModel.defineTheme(start, { theme: { id: 'x', label: 'X', dark: { colours: { bg: 'nope' } } } as never })).toThrow(
      /dark\.colours\.bg/u,
    )
    expect(() => ThemeStateModel.nextAppearance(start, { customTheme: 'missing' })).toThrow(/no saved or gallery theme "missing"/u)
  })

  it('switches to a built-in gallery theme, which cannot be redefined or removed', () => {
    const lagoon = ThemeStateModel.nextAppearance(start, { customTheme: 'honu-lagoon' })
    const state = ThemeStateModel.themeState(lagoon, 'light')
    expect(state).toMatchObject({ customTheme: 'honu-lagoon', isDefault: false, contrastWarnings: [] })
    expect(state.galleryThemes.map(theme => theme.id)).toContain('night-reef')
    expect(() => ThemeStateModel.defineTheme(start, { theme: { ...NORD, id: 'aurora' } })).toThrow(/built-in theme/u)
    expect(() => ThemeStateModel.removeTheme(lagoon, 'honu-lagoon')).toThrow(/built-in gallery theme/u)
  })

  it('keeps the reading veil across theme changes, clamps it, and clears it on reset', () => {
    const veil = ThemeStateModel.nextAppearance(start, { readingBlur: 6, readingTint: 30 })
    const lagoon = ThemeStateModel.nextAppearance(veil, { customTheme: 'honu-lagoon' })
    expect(ThemeStateModel.themeState(lagoon, 'light')).toMatchObject({ readingBlur: 6, readingTint: 30, customTheme: 'honu-lagoon' })
    expect(ThemeStateModel.defineTheme(veil, { theme: NORD })).toMatchObject({ readingBlur: 6, readingTint: 30 })
    expect(ThemeStateModel.nextAppearance(veil, { readingBlur: 99, readingTint: -5 })).toMatchObject({ readingBlur: 24, readingTint: 0 })
    expect(ThemeStateModel.nextAppearance(lagoon, { reset: true })).toMatchObject({ readingBlur: 0, readingTint: 0 })
    expect(appearanceSettings.schema({ readingBlur: 12, readingTint: 40 })).toMatchObject({ readingBlur: 12, readingTint: 40 })
    expect(() => appearanceSettings.schema({ readingTint: 140 })).toThrow()
    // The former readingPanel key stored by an earlier version does not break a Host that reads it.
    expect(() => appearanceSettings.schema({ readingPanel: 'soft' } as never)).not.toThrow()
  })

  it('keeps the scene frame rate across theme changes, clamps it to whole frames, and restores the default on reset', () => {
    const slow = ThemeStateModel.nextAppearance(start, { sceneFrameRate: 4 })
    const lagoon = ThemeStateModel.nextAppearance(slow, { customTheme: 'honu-lagoon' })
    expect(ThemeStateModel.themeState(lagoon, 'light')).toMatchObject({ sceneFrameRate: 4, customTheme: 'honu-lagoon' })
    expect(ThemeStateModel.defineTheme(slow, { theme: NORD })).toMatchObject({ sceneFrameRate: 4 })
    expect(ThemeStateModel.nextAppearance(slow, { sceneFrameRate: 999 })).toMatchObject({ sceneFrameRate: SCENE_FRAME_RATE.max })
    expect(ThemeStateModel.nextAppearance(slow, { sceneFrameRate: -1 })).toMatchObject({ sceneFrameRate: 0 })
    expect(ThemeStateModel.nextAppearance(slow, { sceneFrameRate: 7.6 })).toMatchObject({ sceneFrameRate: 8 })
    expect(ThemeStateModel.nextAppearance(lagoon, { reset: true })).toMatchObject({ sceneFrameRate: SCENE_FRAME_RATE.default })
    // A stored value from before the setting existed, or a broken one, reads as the default.
    expect(ThemeStateModel.normaliseAppearance({ sceneFrameRate: 'fast' })).toMatchObject({ sceneFrameRate: SCENE_FRAME_RATE.default })
    expect(appearanceSettings.schema({ sceneFrameRate: 0 })).toMatchObject({ sceneFrameRate: 0 })
    expect(() => appearanceSettings.schema({ sceneFrameRate: 121 })).toThrow()
  })

  it('removes a theme and falls back to the preset when it was in use', () => {
    const saved = ThemeStateModel.defineTheme(start, { theme: NORD })
    const removed = ThemeStateModel.removeTheme(saved, 'nord')
    expect(removed).toMatchObject({ customTheme: '', customThemes: [] })
    expect(ThemeStateModel.themeState(removed, 'dark').isDefault).toBe(true)
    expect(() => ThemeStateModel.removeTheme(removed, 'nord')).toThrow(InvalidThemeDefinition)
  })

  it('stores a saved theme through the settings contract', () => {
    const saved = ThemeStateModel.defineTheme(start, { theme: NORD })
    const stored = appearanceSettings.schema({ ...saved, customThemes: [...(saved.customThemes ?? [])] })
    expect(ThemeStateModel.normaliseAppearance(stored)).toMatchObject({ customTheme: 'nord', customThemes: [NORD] })
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

  it('binds theme_define and theme_remove as write tools, remove behind an explicit confirm', () => {
    const { define, remove } = themeApi.methods
    expect(define.tool).toMatchObject({ name: 'theme_define', readOnly: false })
    expect(define.description).toMatch(/only when the user asked/u)
    // Round eight: a theme can carry the identity palette users pick project, tag and agent colours from.
    expect(define.description).toMatch(/palette gives the six identity colours/u)
    const scheme = JSON.stringify(Schema.isSchema(define.input) ? Schema.toJsonSchemaDocument(define.input) : null)
    expect(scheme).toContain('"palette"')
    expect(scheme).toContain('"paletteNames"')
    expect(remove.tool).toMatchObject({ name: 'theme_remove', readOnly: false })
    expect(remove.description).toMatch(/confirm: true/u)
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

  it('adds, updates and removes one style element', () => {
    RuntimeTheme.applyThemeCss<FakeElement>(doc, 'a{}')
    expect(doc.getElementById(RUNTIME_STYLE_ID)?.textContent).toBe('a{}')
    RuntimeTheme.applyThemeCss<FakeElement>(doc, 'b{}')
    expect(doc.nodes.size).toBe(1)
    expect(doc.getElementById(RUNTIME_STYLE_ID)?.textContent).toBe('b{}')
    RuntimeTheme.applyThemeCss<FakeElement>(doc, '')
    expect(doc.getElementById(RUNTIME_STYLE_ID)).toBeNull()
  })

  it('caches only a non-default theme', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    RuntimeTheme.writeCachedThemeCss('x{}', storage)
    expect(RuntimeTheme.readCachedThemeCss(storage)).toBe('x{}')
    expect(store.has(RUNTIME_CACHE_KEY)).toBe(true)
    RuntimeTheme.writeCachedThemeCss('', storage)
    expect(store.size).toBe(0)
    expect(RuntimeTheme.readCachedThemeCss(undefined)).toBe('')
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
    expect(RuntimeTheme.readCachedThemeCss(broken)).toBe('')
    expect(() => RuntimeTheme.writeCachedThemeCss('x{}', broken)).not.toThrow()
  })
})
