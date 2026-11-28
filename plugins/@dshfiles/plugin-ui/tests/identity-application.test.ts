import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppearanceModel, DEFAULT_APPEARANCE, RUNTIME_DARK_SELECTOR, RUNTIME_LIGHT_SELECTOR } from '../src/theme/appearance.ts'
import { GALLERY_THEMES } from '../src/theme/gallery.ts'
import { IdentityDerivation } from '../src/theme/identity-derivation.ts'
import { COOL_ORDER, GENERIC_IDENTITY_NAMES } from '../src/theme/identity-palette.ts'

// Vitest runs each package from its root.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const block = (selector: string): string => styles.match(new RegExp(`${selector.replace(/[[\]]/gu, '\\$&')}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? ''
const declared = (body: string): string[] => [...body.matchAll(/--dshx-project-(?:balanced|cool)-\d: [^;]+;/gu)].map(([line]) => line)
/** The identity block a scheme writes: everything between `selector {` and the next `}`. */
const identityBlock = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {\n  --dshx-project-balanced-0:`)
  return start === -1 ? '' : css.slice(start, css.indexOf('}', start))
}

const DRACULA = ['#8be9fd', '#50fa7b', '#ffb86c', '#bd93f9', '#ff79c6', '#f1fa8c'] as const
const ALUCARD = ['#036a96', '#14710a', '#a34d14', '#644ac9', '#a3144d', '#7d6706'] as const
const LIGHT_GUARD = `${RUNTIME_LIGHT_SELECTOR}:not([data-ds-dark-theme])`

describe('identity slots in the default theme (round eight)', () => {
  it('stay exactly the oklch values in styles.css, light and dark', () => {
    const light = [225, 110, 55, 305, 340, 195]
    expect(declared(block(':root'))).toEqual([
      ...light.map((hue, n) => `--dshx-project-balanced-${n}: oklch(0.5 0.11 ${hue});`),
      ...COOL_ORDER.map((slot, n) => `--dshx-project-cool-${n}: oklch(0.5 0.11 ${light[slot]});`),
    ])
    expect(declared(block('body[data-ds-dark-theme]'))).toEqual([
      ...light.map((hue, n) => `--dshx-project-balanced-${n}: oklch(0.78 0.1 ${hue});`),
      ...COOL_ORDER.map((slot, n) => `--dshx-project-cool-${n}: oklch(0.78 0.1 ${light[slot]});`),
    ])
  })

  it('are never written over by the runtime theme while the default applies', () => {
    expect(AppearanceModel.runtimeThemeCss(DEFAULT_APPEARANCE)).toBe('')
    expect(AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, interfaceFont: 'system' })).not.toContain('--dshx-project-')
    // A generated preset keeps the default slots too: it has no colours of its own to match.
    expect(AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, preset: 'slate-blue' })).not.toContain('--dshx-project-')
    expect(AppearanceModel.identityNames(DEFAULT_APPEARANCE)).toEqual({})
  })
})

describe('identity slots of a theme (round eight)', () => {
  it('writes Dracula’s palette over the slots in dark and Alucard’s in light, with the cool permutation', () => {
    const css = AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, preset: 'dracula' })
    for (const [selector, palette] of [
      [RUNTIME_DARK_SELECTOR, DRACULA],
      [LIGHT_GUARD, ALUCARD],
    ] as const) {
      const body = identityBlock(css, selector)
      palette.forEach((colour, n) => expect(body).toContain(`--dshx-project-balanced-${n}: ${colour};`))
      COOL_ORDER.forEach((slot, n) => expect(body).toContain(`--dshx-project-cool-${n}: ${palette[slot]};`))
    }
    // The light slots are guarded: a light value never shows in dark.
    expect(css).not.toContain(`${RUNTIME_LIGHT_SELECTOR} {\n  --dshx-project-balanced-0:`)
    expect(AppearanceModel.identityNames({ ...DEFAULT_APPEARANCE, preset: 'dracula' })).toEqual({
      light: ['Cyan', 'Green', 'Orange', 'Purple', 'Pink', 'Yellow'],
      dark: ['Cyan', 'Green', 'Orange', 'Purple', 'Pink', 'Yellow'],
    })
  })

  it('writes the derived palette for a gallery theme, only in the scheme it defines', () => {
    const reef = GALLERY_THEMES.find(theme => theme.id === 'night-reef')!
    const settings = { ...DEFAULT_APPEARANCE, customTheme: 'night-reef' }
    const css = AppearanceModel.runtimeThemeCss(settings)
    const derived = IdentityDerivation.derive(reef.dark!, 'dark')
    derived.forEach((colour, n) => expect(identityBlock(css, RUNTIME_DARK_SELECTOR)).toContain(`--dshx-project-balanced-${n}: ${colour};`))
    expect(identityBlock(css, LIGHT_GUARD)).toBe('')
    expect(AppearanceModel.identityNames(settings)).toEqual({ dark: GENERIC_IDENTITY_NAMES })
  })

  it('drops the theme’s slots with its colours once an override asks for the generated palette', () => {
    const settings = { ...DEFAULT_APPEARANCE, preset: 'dracula' as const, accentHue: 200 }
    expect(AppearanceModel.runtimeThemeCss(settings)).not.toContain('--dshx-project-')
    expect(AppearanceModel.identityNames(settings)).toEqual({})
  })

  it('removes the slots when the theme is cleared: the default theme injects nothing', () => {
    const dracula = AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, preset: 'dracula' })
    expect(dracula).toContain('--dshx-project-balanced-0: #8be9fd;')
    expect(AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, preset: 'dracula', customTheme: '' })).toBe(dracula)
    expect(AppearanceModel.runtimeThemeCss({ ...DEFAULT_APPEARANCE, preset: 'warm-stone' })).toBe('')
  })
})
