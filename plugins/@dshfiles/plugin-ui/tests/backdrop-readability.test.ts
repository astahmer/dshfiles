/**
 * Every theme that paints a scene, held to readability over its real scene (b:d5wg): all gallery themes in both
 * schemes, and a saved theme whose palette fights its scene. The pixels are Chrome's own raster of each scene
 * (tests/fixtures/scene-samples.json), the same sample the client draws.
 */
import { describe, expect, it } from 'vitest'
import { DRACULA_THEME } from '../src/theme/dracula.ts'
import { GALLERY_THEMES } from '../src/theme/gallery.ts'
import { ReadabilityModel, type Rgb } from '../src/theme/readability.ts'
import { SCENES } from '../src/theme/scene-catalog.ts'
import {
  BUBBLE_RING,
  GPU_ATTRIBUTE,
  RAIL_RING,
  ThemeDefinitionModel,
  type ReadingVeil,
  type SchemeTheme,
  type ThemeDefinition,
} from '../src/theme/theme-definition.ts'
import { SAMPLED_SCENES } from './scene-fixture.ts'

const hex = ReadabilityModel.hexToRgb
const luminance = (rgb: Rgb) => ReadabilityModel.contrast(rgb, [0, 0, 0])

/** A saved theme painting a bright scene under Dracula's dark palette: the veil has to do all the work. */
const MISMATCHED: ThemeDefinition = {
  id: 'dracula-on-paper',
  label: 'Dracula on paper',
  dark: { colours: DRACULA_THEME.dark?.colours ?? GALLERY_THEMES[0]!.light!.colours, backdrop: { scene: 'paper-garden' } },
}

interface Case {
  readonly name: string
  readonly scheme: SchemeTheme
}

const CASES: readonly Case[] = [...GALLERY_THEMES, MISMATCHED].flatMap(theme =>
  (['light', 'dark'] as const).flatMap(scheme => {
    const value = theme[scheme]
    return value?.backdrop?.scene === undefined ? [] : [{ name: `${theme.id}/${scheme}`, scheme: value }]
  }),
)

const READINGS: readonly ReadingVeil[] = [
  { blur: 0, tint: 0 },
  { blur: 3, tint: 0 },
  { blur: 6, tint: 40 },
]

/** The share of pixels a target must read on: the veil's own coverage, so stray stars and sparks do not count. */
const COVERAGE = 0.95

/** A target's floor: its WCAG minimum, or what the theme's own background gives it when that is less. */
const floor = (colour: string, bg: string, min: number) => Math.min(min, ReadabilityModel.contrast(hex(colour), hex(bg))) - 0.06

const shareReading = (backgrounds: readonly Rgb[], colour: string, min: number) =>
  backgrounds.filter(under => ReadabilityModel.contrast(hex(colour), under) >= min).length / backgrounds.length

describe('every theme reads over its scene', () => {
  it('covers every built-in scene, sampled from a real raster', () => {
    expect([...SAMPLED_SCENES.keys()].sort()).toEqual(SCENES.map(scene => scene.id).sort())
    expect(CASES.length).toBe(SCENES.length + 1)
  })

  for (const { name, scheme } of CASES) {
    const scene = scheme.backdrop?.scene ?? ''
    const source = SAMPLED_SCENES.get(scene)
    const c = scheme.colours
    const glass = scheme.backdrop?.glass === undefined ? undefined : { colour: hex(scheme.backdrop.glass.tint), opacity: scheme.backdrop.glass.opacity }

    /** The scene under the glass, each pixel as strong as the glass is at its x: a column can sit anywhere (splits). */
    const glassed = (source?.surround ?? []).map((pixel, index) =>
      glass === undefined
        ? pixel
        : ReadabilityModel.composite(pixel, glass.colour, glass.opacity * ThemeDefinitionModel.glassWeight(((index % 64) + 0.5) / 64)),
    )

    /** The theme's own grey on its plain background: a grey over the scene must read at least that well. */
    const plain = (colour: string) => ReadabilityModel.contrast(hex(colour), hex(c.bg)) - 0.06

    it(`${name}: text reads, and its greys read as well as on the plain theme, in a column anywhere over the scene, at every blur and tint`, () => {
      for (const reading of READINGS) {
        const { opacity, greys } = ThemeDefinitionModel.veilMaterial(scheme, source, reading)
        const under = glassed.map(pixel => ReadabilityModel.composite(pixel, hex(c.bg), opacity))
        const at = JSON.stringify(reading)
        expect(shareReading(under, c.text, floor(c.text, c.bg, 4.5)), `text at ${at}`).toBeGreaterThanOrEqual(COVERAGE)
        expect(shareReading(under, greys.muted, plain(c.muted)), `muted at ${at}`).toBeGreaterThanOrEqual(COVERAGE)
        expect(shareReading(under, greys.faint, plain(c.faint)), `faint at ${at}`).toBeGreaterThanOrEqual(COVERAGE)
      }
    })

    it(`${name}: its greys over the scene are its own, a little brighter`, () => {
      const { greys } = ThemeDefinitionModel.veilMaterial(scheme, source)
      expect(ReadabilityModel.contrast(hex(greys.faint), hex(c.bg))).toBeGreaterThan(ReadabilityModel.contrast(hex(c.faint), hex(c.bg)))
      expect(ReadabilityModel.contrast(hex(greys.faint), hex(c.bg))).toBeLessThan(ReadabilityModel.contrast(hex(c.muted), hex(c.bg)))
      expect(ReadabilityModel.contrast(hex(greys.muted), hex(c.bg))).toBeGreaterThan(ReadabilityModel.contrast(hex(c.muted), hex(c.bg)))
      expect(ReadabilityModel.contrast(hex(greys.muted), hex(c.bg))).toBeLessThan(ReadabilityModel.contrast(hex(c.text), hex(c.bg)))
    })

    it(`${name}: chrome outside the column (the turn rail) reads on its surface`, () => {
      const { chrome, greys } = ThemeDefinitionModel.veilMaterial(scheme, source)
      const under = (source?.surround ?? []).map(pixel => ReadabilityModel.composite(pixel, hex(c.bg), chrome))
      expect(shareReading(under, greys.muted, plain(c.muted)), 'muted').toBeGreaterThanOrEqual(COVERAGE)
      expect(shareReading(under, greys.faint, plain(c.faint)), 'faint').toBeGreaterThanOrEqual(COVERAGE)
      expect(shareReading(under, c.borderStrong, floor(c.borderStrong, c.bg, 3)), 'borderStrong').toBeGreaterThanOrEqual(COVERAGE)
    })

    it(`${name}: the user's bubble stands apart from the veiled scene behind it`, () => {
      const { opacity } = ThemeDefinitionModel.veilMaterial(scheme, source)
      const under = glassed.map(pixel => ReadabilityModel.composite(pixel, hex(c.bg), opacity))
      const median = [...under].sort((a, b) => luminance(a) - luminance(b))[Math.floor(under.length / 2)] ?? hex(c.bg)
      // Its fill or its hairline ring (BUBBLE_RING draws borderStrong): whichever the scene leaves more room for.
      const separation = Math.max(ReadabilityModel.contrast(hex(c.raised), median), ReadabilityModel.contrast(hex(c.borderStrong), median))
      expect(separation).toBeGreaterThanOrEqual(1.25)
    })
  }
})

describe('the backdrop stack', () => {
  const theme = GALLERY_THEMES.find(candidate => candidate.id === 'paper-garden')!
  const css = (reading: ReadingVeil) => ThemeDefinitionModel.css(theme, { light: 'html:root body', dark: 'body[data-ds-dark-theme]' }, SAMPLED_SCENES, reading)
  const rules = (text: string) => text.split('\n}').map(rule => rule.trim())

  it('draws one scene for the whole workbench: docked panes give up the transform that re-framed fixed backgrounds', () => {
    const text = css({ blur: 3, tint: 20 })
    expect(text).toMatch(/\.dv-render-overlay:not\(\.dv-render-overlay-float\) \{\n {2}transform: none;\n {2}will-change: auto;\n {2}contain: none;/u)
    // The veil's still and the composer seat's are both fixed to the viewport, like the scene.
    const seat = rules(text).find(rule => rule.includes('[data-composer-seat]::before {'))
    expect(seat).toContain('background-attachment: scroll, fixed;')
    expect(seat).toContain('mask-composite: intersect;')
    // The seat itself drops its transform hint and its plain fade; the mask sits on the pseudo-element only, never on the
    // composer card the seat holds.
    const own = rules(text).find(rule => rule.endsWith('[data-composer-seat] {\n  will-change: auto;\n  background: none;'))
    expect(own).toBeDefined()
  })

  it('keeps every pane but conversations on the theme surface, and hands chrome and bubbles their surfaces', () => {
    const text = css({ blur: 0, tint: 0 })
    expect(text).toContain('[data-workbench-panel-id]:not(:has([data-conversation-content])) {\n  background-color: var(--dshx-tone-0);')
    expect(text).toMatch(/--dshx-backdrop-chrome: rgb\(\d+ \d+ \d+ \/ [\d.]+\);/u)
    expect(text).toContain(`--dshx-backdrop-bubble-ring: ${BUBBLE_RING};`)
    // The turn rail's pill: centred ticks, a soft ring. A plain theme sets none of it, so its rail stays as it was.
    expect(text).toContain(`--dshx-backdrop-rail-ring: ${RAIL_RING};`)
    expect(text).toContain('--dshx-backdrop-rail-origin: center;')
    expect(ThemeDefinitionModel.css({ id: 'plain', label: 'Plain', dark: { colours: theme.light!.colours } }, { light: 'body', dark: 'body' })).not.toContain(
      '--dshx-backdrop-',
    )
    // With no blur the seat continues the scene with its resting picture.
    const seat = rules(text).find(rule => rule.includes('[data-composer-seat]::before {'))
    expect(seat).toMatch(/background-attachment: (scroll, )?fixed;/u)
    expect(seat).not.toContain('feGaussianBlur')
  })

  it('blurs the moving scene live only where the browser composites on a GPU, the still everywhere else', () => {
    const text = css({ blur: 3, tint: 0 })
    const filtered = rules(text).filter(rule => rule.includes('backdrop-filter'))
    expect(filtered.length).toBeGreaterThan(0)
    for (const rule of filtered) expect(rule.split('{')[0]).toContain(`[${GPU_ATTRIBUTE}]`)
    expect(css({ blur: 0, tint: 0 })).not.toContain('backdrop-filter')
  })

  it('lifts the conversation greys only for a theme painting a scene, from its own palette', () => {
    const text = css({ blur: 3, tint: 0 })
    const greys = ThemeDefinitionModel.veilMaterial(theme.light!, SAMPLED_SCENES.get('paper-garden')).greys
    expect(text).toContain(`[data-conversation-content] {\n  --dshx-tone-8: ${greys.faint};`)
    expect(text).toContain(`  --dsw-alias-label-secondary: ${greys.muted};`)
    // Dracula's night sky (layers, no scene) and every plain theme keep their greys.
    const dracula = ThemeDefinitionModel.css(DRACULA_THEME, { light: 'html:root body', dark: 'body[data-ds-dark-theme]' }, SAMPLED_SCENES, { blur: 3, tint: 0 })
    expect(dracula).not.toContain('--dsw-alias-label-secondary')
  })

  it('leaves layer-only backdrops (Dracula) their own composer seat', () => {
    const text = ThemeDefinitionModel.css(DRACULA_THEME, { light: 'html:root body', dark: 'body[data-ds-dark-theme]' }, SAMPLED_SCENES, { blur: 3, tint: 20 })
    expect(text).not.toContain('[data-composer-seat]')
    expect(text).toContain('--dshx-backdrop-chrome:')
  })
})
