import { describe, expect, it } from 'vitest'
import { AppearanceModel, DEFAULT_APPEARANCE, PRESET_IDS, RUNTIME_DARK_SELECTOR, RUNTIME_LIGHT_SELECTOR } from '../src/theme/appearance.ts'
import { DRACULA_THEME } from '../src/theme/dracula.ts'
import { BACKDROP_HOST, ThemeDefinitionModel, type ThemeDefinition } from '../src/theme/theme-definition.ts'

const colours = (bg: string, text: string, accent: string) => ({
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

const NORD: ThemeDefinition = {
  id: 'nord',
  label: 'Nord',
  dark: {
    colours: colours('#2e3440', '#eceff4', '#88c0d0'),
    syntax: { keyword: '#81a1c1' },
    backdrop: {
      layers: ['background: linear-gradient(#2e3440, #3b4252); animation: nord-drift 9s infinite'],
      keyframes: '@keyframes nord-drift { from { opacity: .6 } to { opacity: 1 } }',
    },
  },
}

describe('theme definitions', () => {
  it('parses a complete definition and refuses the problems an agent could make', () => {
    expect(ThemeDefinitionModel.parse(NORD).errors).toEqual([])
    const bad = ThemeDefinitionModel.parse({ id: 'Bad Id', label: '', dark: { colours: { bg: 'red' } } }, PRESET_IDS)
    expect(bad.definition).toBeUndefined()
    expect(bad.errors).toContain('id: lowercase letters, digits and hyphens, at most 48 characters')
    expect(bad.errors.some(error => error.startsWith('dark.colours.bg:'))).toBe(true)
    expect(ThemeDefinitionModel.parse({ ...NORD, id: 'dracula' }, PRESET_IDS).errors).toEqual(['id: "dracula" is a built-in theme; pick another id'])
    expect(ThemeDefinitionModel.parse({ id: 'x', label: 'X' }).errors).toContain('give at least one scheme: dark, light or both')
  })

  it('keeps a backdrop self-contained: no url(), @import or a brace that escapes its layer', () => {
    const withLayer = (layer: string, keyframes?: string) =>
      ThemeDefinitionModel.parse({ ...NORD, dark: { ...NORD.dark, backdrop: keyframes === undefined ? { layers: [layer] } : { layers: [layer], keyframes } } }).errors
    expect(withLayer('background: url(https://evil.test/x.png)')).toHaveLength(1)
    expect(withLayer('color: red } body { display: none')).toHaveLength(1)
    expect(withLayer('opacity: 1', '@import "x.css";')).not.toHaveLength(0)
    expect(withLayer('opacity: 1', 'body { display: none }')).toEqual(['dark.backdrop: keyframes may only hold @keyframes blocks'])
    expect(withLayer('opacity: 1', '@keyframes a { from { opacity: 0 }')).toEqual(['dark.backdrop: keyframes have unbalanced braces'])
    expect(ThemeDefinitionModel.parse({ ...NORD, dark: { ...NORD.dark, backdrop: { layers: ['a: 1', 'b: 1', 'c: 1', 'd: 1'] } } }).errors).toEqual([
      'dark.backdrop: at most 3 layers, and 4 items with the scene and the glass',
    ])
  })

  it('applies a saved theme live, pinned over the palette generated from its own hues', () => {
    const settings = { ...DEFAULT_APPEARANCE, customTheme: 'nord', customThemes: [NORD, { id: 'broken' }] }
    expect(AppearanceModel.customThemes(settings).map(theme => theme.id)).toEqual(['nord'])
    const css = AppearanceModel.runtimeThemeCss(settings)
    expect(css).toContain(`${RUNTIME_DARK_SELECTOR} {\n  --dshx-tone-0: #2e3440;`)
    expect(css).toContain('--shiki-token-keyword: #81a1c1;')
    // A pinned theme's panel is its nav column too (council round 6 A4): the generated lift never overrides it.
    expect(css).toContain(`--dshx-tone-nav: ${NORD.dark!.colours.panel};`)
    // Its Ready dot is its own success colour (council round 6 A6).
    expect(css).toContain(`--dshx-ready-mark: ${NORD.dark!.colours.success};`)
    expect(css).toContain(`${RUNTIME_DARK_SELECTOR} ${BACKDROP_HOST}::before {`)
    expect(css).toContain('animation: nord-drift 9s infinite;')
    expect(css).toContain('@keyframes nord-drift')
    // Only dark was given: light keeps the generated palette, with no pins and no backdrop.
    expect(css).not.toContain(`${RUNTIME_LIGHT_SELECTOR} {\n  --dshx-tone-0: #`)
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('falls back to the preset when the chosen theme is missing or invalid', () => {
    expect(AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, customTheme: 'gone', customThemes: [NORD] })).toBe('')
    expect(AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, customTheme: 'nord', customThemes: [{ ...NORD, label: '' }] })).toBe('')
  })

  it('drops the exact colours and backdrop once an override asks for the generated palette', () => {
    const css = AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, preset: 'dracula', accentHue: 200 })
    expect(css).toContain('--dshx-tone-0: oklch(')
    expect(css).not.toContain('#282a36')
    expect(css).not.toContain('dshx-dracula-twinkle')
  })
})

describe('built-in Dracula', () => {
  it('is a valid definition with the official Dracula and Alucard backgrounds', () => {
    expect(ThemeDefinitionModel.parse(DRACULA_THEME).errors).toEqual([])
    const css = AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, preset: 'dracula' })
    expect(css).toContain(`${RUNTIME_DARK_SELECTOR} {\n  --dshx-tone-0: #282a36;`)
    expect(css).toContain(`${RUNTIME_LIGHT_SELECTOR} {\n  --dshx-tone-0: #fffbeb;`)
    expect(css).toContain('--shiki-token-keyword: #ff79c6;')
    expect(css).toContain('--shiki-token-keyword: #a3144d;')
  })

  it('keeps AA except the three spec colours that sit just under it in Alucard', () => {
    expect(ThemeDefinitionModel.contrastWarnings(DRACULA_THEME)).toEqual([
      'light: danger on panel is 4.26:1 (needs 4.5:1)',
      'light: danger on raised is 4.14:1 (needs 4.5:1)',
      'light: syntax string on panel is 4.22:1 (needs 4.5:1)',
    ])
  })

  it('paints the night sky only in dark, animating opacity alone', () => {
    const css = AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, preset: 'dracula' })
    const scene = `${RUNTIME_DARK_SELECTOR} ${BACKDROP_HOST}`
    expect(css).toContain(`${scene} {\n  isolation: isolate;`)
    expect(css).toContain(`${scene}::before {`)
    expect(css).toContain(`${scene} .dv-dockview::after {`)
    expect(css).toContain('@keyframes dshx-dracula-twinkle { from { opacity: 0.15; } to { opacity: 1; } }')
    expect(css).not.toContain(`${RUNTIME_LIGHT_SELECTOR}:not([data-ds-dark-theme]) ${BACKDROP_HOST}`)
    expect(css).not.toMatch(/url\(/u)
  })
})
