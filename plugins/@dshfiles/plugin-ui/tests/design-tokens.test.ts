import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOST_RADII } from '../src/theme/theme-css.ts'

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const theme = styles.slice(styles.indexOf('@theme inline'), styles.indexOf('}', styles.indexOf('--text-display--letter-spacing')))

describe('kit design tokens (visual refresh T0.5)', () => {
  it('reads one radius scale from the remapped Host radii, with the same values as fallbacks', () => {
    const kit = { sm: 'xs', md: 'sm', lg: 'md', xl: 'lg', '2xl': 'panel' } as const
    for (const [step, host] of Object.entries(kit)) {
      expect(theme).toContain(`--radius-${step}: var(--dsw-radius-${host}, ${HOST_RADII[host]}px);`)
    }
    expect(Object.values(HOST_RADII)).toEqual([4, 6, 8, 12, 12, 16])
  })

  it('keeps the desktop text steps at 12/13/14px so P0 moves no layout', () => {
    expect(theme).toContain('--text-xs: 0.75rem;')
    expect(theme).toContain('--text-sm: 0.8125rem;')
    expect(theme).toContain('--text-base: 0.875rem;')
  })

  it('names heights, elevation levels and the two easing curves', () => {
    for (const name of ['control-compact', 'control', 'row', 'bar', 'touch']) expect(theme).toContain(`--spacing-${name}: var(--dshx-size-${name});`)
    for (const level of [1, 2, 3]) expect(theme).toContain(`--shadow-s${level}: var(--dshx-elevation-${level});`)
    expect(theme).toContain('--shadow-s0: none;')
    expect(styles).toContain('--dshx-size-control-compact: 24px;')
    expect(styles).toContain('--dshx-size-touch: 44px;')
    expect(styles).toContain('--dshx-motion-ease-enter: cubic-bezier(0.2, 0, 0, 1);')
    for (const [name, ms] of Object.entries({ hover: 80, fade: 120, menu: 160, panel: 220, sheet: 280, exit: 100 })) {
      expect(styles).toContain(`--dshx-duration-${name}: ${ms}ms;`)
    }
  })

  it('gives dark elevation an inner top highlight', () => {
    const dark = styles.slice(styles.indexOf('Elevation, dark'))
    for (const level of [1, 2, 3]) expect(dark).toMatch(new RegExp(`--dshx-elevation-${level}:[^;]*inset 0 1px 0`, 'u'))
  })

  it('switches comfortable density by pointer and width, never by user agent', () => {
    const coarse = styles.slice(styles.indexOf('Comfortable density on touch'))
    expect(coarse).toMatch(/@media \(pointer: coarse\) \{\s*:root \{\s*--dshx-density-text-input: 16px;\s*--dshx-density-target: 44px;/u)
    expect(coarse).toContain('@media (pointer: coarse) and (max-width: 28rem)')
    expect(coarse).toContain('@container (max-width: 28rem)')
    for (const [name, px] of Object.entries({ ui: 15, prose: 15, meta: 13, min: 12 })) expect(coarse).toContain(`--dshx-density-text-${name}: ${px}px;`)
    expect(styles).not.toMatch(/userAgent|-webkit-touch-callout/u)
    for (const side of ['top', 'right', 'bottom', 'left']) expect(styles).toContain(`--dshx-safe-${side}: env(safe-area-inset-${side}, 0px);`)
  })
})
