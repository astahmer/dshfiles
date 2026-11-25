import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

// Council round 5 A4: two surface roles, so every navigation column sits on `nav` and every page on `stage`.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const surfaces = readFileSync(join(process.cwd(), 'src/surfaces.css'), 'utf8')
const generated = readFileSync(join(process.cwd(), '../ui-styles/src/theme.generated.css'), 'utf8')

const block = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {`)
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start))
}

describe('surface roles (council round 5 A4)', () => {
  it('declares nav on its own generated tone and stage on the canvas step, with Host fallbacks', () => {
    const body = block(surfaces, '  body')
    expect(body).toContain('--dshx-surface-nav: var(--dshx-tone-nav, var(--dshx-tone-panel, var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1))));')
    expect(body).toContain('--dshx-surface-stage: var(--dshx-tone-bg, var(--dsw-alias-bg-base));')
  })

  it('exposes bg utilities and surface-* utilities that also name the current surface for fades and rings', () => {
    expect(styles).toContain('--color-surface-nav: var(--dshx-surface-nav);')
    expect(styles).toContain('--color-surface-stage: var(--dshx-surface-stage);')
    for (const role of ['nav', 'stage']) {
      const utility = block(surfaces, `@utility surface-${role}`)
      expect(utility).toContain(`--dshx-surface: var(--dshx-surface-${role});`)
      expect(utility).toContain('background-color: var(--dshx-surface);')
    }
  })

  it('maps the theme panel and bg steps to tones 1 and 0 in both schemes', () => {
    for (const selector of ['html body', 'body[data-ds-dark-theme][data-ds-dark-theme]']) {
      const theme = block(generated, selector)
      expect(theme).toContain('--dshx-tone-panel: var(--dshx-tone-1);')
      expect(theme).toContain('--dshx-tone-bg: var(--dshx-tone-0);')
    }
  })

  it.each<[Scheme, string, string]>([
    ['light', '#f4f2f0', '#fefcfa'],
    ['dark', '#1e1b19', '#15120f'],
  ])('renders nav and stage as the documented hex (%s)', (scheme, nav, stage) => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(PaletteMath.toHex(p.navSurface)).toBe(nav)
    expect(PaletteMath.toHex(p.neutral[0]!)).toBe(stage)
  })

  it('lifts the dark nav column to oklch(0.225 0.006 60) so column and page separate without a hairline; light is the panel step (council round 6 A4)', () => {
    const light = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' })
    const dark = PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' })
    expect(light.navSurface).toEqual(light.neutral[1])
    expect(dark.navSurface).toEqual({ l: 0.225, c: 0.006, h: 60 })
    expect(dark.navSurface.l - dark.neutral[0]!.l).toBeGreaterThanOrEqual(0.04)
    // The Host sidebar fill (frame-layout, the thread list) follows the same tone, so the column is one fill.
    for (const scheme of ['light', 'dark'] as const) {
      const declarations = ThemeCss.blockDeclarations(WARM_STONE, scheme).join('\n')
      expect(declarations).toContain(`--dshx-tone-nav: ${PaletteMath.toCss(scheme === 'light' ? light.navSurface : dark.navSurface)};`)
      expect(declarations).toContain('--dsw-specific-sidebar-fill: var(--dshx-tone-nav);')
    }
  })

  it.each<Scheme>(['light', 'dark'])('keeps every text role at AA, glyphs and field edges at 3:1 and the washes apart on nav (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const nav = p.navSurface
    for (const step of [8, 9, 10]) expect(PaletteMath.contrastRatio(p.neutral[step]!, nav), `step ${step}`).toBeGreaterThanOrEqual(4.5)
    for (const key of ['accent', 'success', 'warning', 'danger', 'info'] as const) expect(PaletteMath.contrastRatio(p[key].fg, nav), key).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.fieldBorder, nav), 'field border').toBeGreaterThanOrEqual(3)
    // A selected row still reads as a lightness step off the column; a Needs-you or Failed row by its hue.
    expect(Math.abs(p.selectedWash.l - nav.l)).toBeGreaterThanOrEqual(0.025)
    for (const wash of [p.needsYouWash, p.failedWash]) expect(wash.c - nav.c).toBeGreaterThanOrEqual(0.025)
  })
})
