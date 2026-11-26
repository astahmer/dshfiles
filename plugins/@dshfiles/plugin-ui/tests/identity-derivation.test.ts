import { describe, expect, it } from 'vitest'
import { DRACULA_THEME } from '../src/theme/dracula.ts'
import { GALLERY_THEMES } from '../src/theme/gallery.ts'
import { hueDistance, IdentityDerivation, STATUS_HUE_DISTANCE } from '../src/theme/identity-derivation.ts'
import { PaletteMath, type Scheme } from '../src/theme/palette.ts'
import { ReadabilityModel } from '../src/theme/readability.ts'
import { ThemeDefinitionModel, type SchemeTheme, type ThemeDefinition } from '../src/theme/theme-definition.ts'

/** A theme an agent saved through theme_define (Nord, its official palette), parsed as the Host stores it. */
const SAVED_NORD = ThemeDefinitionModel.parse({
  id: 'nord',
  label: 'Nord',
  dark: {
    colours: {
      bg: '#2e3440',
      panel: '#3b4252',
      raised: '#434c5e',
      selected: '#4c566a',
      line: '#3b4252',
      border: '#4c566a',
      borderStrong: '#616e88',
      strong: '#7b88a1',
      faint: '#9aa5bd',
      muted: '#d8dee9',
      text: '#eceff4',
      accent: '#88c0d0',
      onAccent: '#2e3440',
      success: '#a3be8c',
      warning: '#ebcb8b',
      danger: '#bf616a',
      info: '#81a1c1',
    },
    syntax: { keyword: '#81a1c1', function: '#88c0d0', string: '#a3be8c', constant: '#b48ead', parameter: '#d8dee9' },
  },
}).definition!

/** A theme with no hue at all: every slot comes from the fill. */
const GREY: SchemeTheme = {
  colours: { ...SAVED_NORD.dark!.colours, accent: '#888888', info: '#999999', success: '#aaaaaa', warning: '#bbbbbb', danger: '#cccccc' },
}

const schemesOf = (theme: ThemeDefinition): [string, Scheme, SchemeTheme][] =>
  (['light', 'dark'] as const).flatMap(scheme => {
    const value = theme[scheme]
    if (value === undefined) return []
    const entry: [string, Scheme, SchemeTheme] = [`${theme.id} ${scheme}`, scheme, value]
    return [entry]
  })

const CASES: [string, Scheme, SchemeTheme][] = [
  // Derivation reads only colours and syntax, so Dracula and Alucard are measured as if they gave no palette.
  ...schemesOf(DRACULA_THEME),
  ...GALLERY_THEMES.flatMap(schemesOf),
  ...schemesOf(SAVED_NORD),
  ['grey dark', 'dark', GREY],
]

const ratio = (a: string, b: string): number => ReadabilityModel.contrast(ReadabilityModel.hexToRgb(a), ReadabilityModel.hexToRgb(b))

describe('derived identity palette (round eight)', () => {
  it('covers Dracula, Alucard, every gallery theme and a saved theme', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(2 + GALLERY_THEMES.length + 1)
  })

  it.each(CASES)('%s: six tones that read as text (4.5:1) on bg, panel and raised', (_, scheme, theme) => {
    const palette = IdentityDerivation.derive(theme, scheme)
    expect(palette).toHaveLength(6)
    for (const tone of palette) {
      expect(tone).toMatch(/^#[0-9a-f]{6}$/u)
      for (const surface of ['bg', 'panel', 'raised'] as const) expect(ratio(tone, theme.colours[surface]), `${tone} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(CASES)('%s: six distinct hues, each clear of danger, warning and success', (_, scheme, theme) => {
    const hues = IdentityDerivation.derive(theme, scheme).map(tone => PaletteMath.hexToOklch(tone).h)
    for (const [i, a] of hues.entries()) for (const b of hues.slice(i + 1)) expect(hueDistance(a, b), `${a} vs ${b}`).toBeGreaterThanOrEqual(15)
    const status = [theme.colours.danger, theme.colours.warning, theme.colours.success].map(PaletteMath.hexToOklch).filter(colour => colour.c >= 0.04)
    // Chosen at 25° or more; rounding the fitted tone to #rrggbb moves its hue by a fraction of a degree.
    for (const hue of hues)
      for (const state of status) expect(hueDistance(hue, state.h), `hue ${hue} vs status ${state.h}`).toBeGreaterThanOrEqual(STATUS_HUE_DISTANCE - 0.5)
  })

  it.each(CASES)('%s: is deterministic', (_, scheme, theme) => {
    expect(IdentityDerivation.derive(theme, scheme)).toEqual(IdentityDerivation.derive(theme, scheme))
  })

  it('starts from the theme’s own colours: Nord keeps its frost blues and purple, never its green success', () => {
    const hues = IdentityDerivation.derive(SAVED_NORD.dark!, 'dark').map(tone => PaletteMath.hexToOklch(tone).h)
    const hueOf = (hex: string) => PaletteMath.hexToOklch(hex).h
    // Lightness moves (to read on Nord's raised #434c5e), hue stays.
    for (const own of ['#81a1c1', '#88c0d0', '#b48ead']) expect(Math.min(...hues.map(hue => hueDistance(hue, hueOf(own)))), own).toBeLessThan(1.5)
    expect(Math.min(...hues.map(hue => hueDistance(hue, hueOf('#a3be8c'))))).toBeGreaterThanOrEqual(STATUS_HUE_DISTANCE - 0.5)
    // Its purple (oklch hue 333) lands on magenta's slot (4).
    expect(hueDistance(hues[4]!, hueOf('#b48ead'))).toBeLessThan(1.5)
  })

  it('uses Dracula’s pink and cyan but not its green (success) or orange (warning) when deriving', () => {
    const dracula = DRACULA_THEME.dark!
    const palette = IdentityDerivation.derive({ colours: dracula.colours, syntax: dracula.syntax ?? {} }, 'dark')
    expect(palette).toContain('#ff79c6')
    expect(palette).toContain('#8be9fd')
    expect(palette).not.toContain('#50fa7b')
    expect(palette).not.toContain('#ffb86c')
  })

  it('prefers an explicit palette over the derived one', () => {
    const palette = ['#111111', '#222222', '#333333', '#444444', '#555555', '#666666'] as const
    expect(IdentityDerivation.paletteOf({ ...SAVED_NORD.dark!, palette }, 'dark')).toBe(palette)
    expect(IdentityDerivation.paletteOf(SAVED_NORD.dark!, 'dark')).toEqual(IdentityDerivation.derive(SAVED_NORD.dark!, 'dark'))
  })
})
