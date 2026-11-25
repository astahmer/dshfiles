import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'

// Council round 5 A4: two surface roles, so every navigation column sits on `nav` and every page on `stage`.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const surfaces = readFileSync(join(process.cwd(), 'src/surfaces.css'), 'utf8')
const generated = readFileSync(join(process.cwd(), '../ui-styles/src/theme.generated.css'), 'utf8')

const block = (css: string, selector: string): string => {
  const start = css.indexOf(`${selector} {`)
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start))
}

describe('surface roles (council round 5 A4)', () => {
  it('declares nav on the panel step and stage on the canvas step, with Host fallbacks', () => {
    const body = block(surfaces, '  body')
    expect(body).toContain('--dshx-surface-nav: var(--dshx-tone-panel, var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1)));')
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
    ['dark', '#1b1815', '#15120f'],
  ])('renders nav and stage as the documented hex (%s)', (scheme, nav, stage) => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(PaletteMath.toHex(p.neutral[1]!)).toBe(nav)
    expect(PaletteMath.toHex(p.neutral[0]!)).toBe(stage)
  })
})
