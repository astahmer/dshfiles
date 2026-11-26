import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'
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

  it('steps the faint ink inside a nav column to the secondary step in light, so it holds AA on the row hover fill (council round 13 A3)', () => {
    // The hover fill is ink at 6% (light) / 7% (dark) over the column; light faint (step 8) sat at 4.39:1 on it.
    expect(block(surfaces, '  body')).toContain('--dshx-nav-faint: var(--dsw-alias-label-secondary);')
    expect(block(surfaces, '  body[data-ds-dark-theme]')).toContain('--dshx-nav-faint: var(--dsw-alias-label-tertiary);')
    const utility = block(surfaces, '@utility surface-nav')
    expect(utility).toContain('--dsw-alias-label-tertiary: var(--dshx-nav-faint);')
    expect(utility).toContain('--dsw-alias-label-caption: var(--dshx-nav-faint);')
  })

  it.each<[Scheme, number, number]>([
    ['light', 0.06, 9],
    ['dark', 0.07, 8],
  ])('keeps the secondary and the nav faint ink AA on the row hover fill over nav (%s)', (scheme, alpha, faint) => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const channels = (color: Oklch) => [1, 3, 5].map(at => Number.parseInt(PaletteMath.toHex(color).slice(at, at + 2), 16))
    const [under, ink] = [channels(p.navSurface), channels(p.neutral[10]!)]
    const hover = PaletteMath.hexToOklch(`#${under.map((value, i) => Math.round(value * (1 - alpha) + (ink[i] ?? 0) * alpha).toString(16).padStart(2, '0')).join('')}`)
    expect(ThemeCss.blockDeclarations(WARM_STONE, scheme).join('\n')).toContain(`--dsw-alias-interactive-bg-hover: color-mix(in oklch, var(--dshx-tone-10) ${Math.round(alpha * 100)}%, transparent);`)
    for (const step of [9, faint]) expect(PaletteMath.contrastRatio(p.neutral[step]!, hover), `step ${step}`).toBeGreaterThanOrEqual(4.5)
    for (const step of [9, faint]) expect(PaletteMath.contrastRatio(p.neutral[step]!, p.selectedWash), `step ${step} on wash`).toBeGreaterThanOrEqual(4.5)
  })
})
