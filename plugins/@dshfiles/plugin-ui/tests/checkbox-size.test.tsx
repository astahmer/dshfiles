// @vitest-environment jsdom
/**
 * The dense checkbox (council round 11 A5): a table column of checkboxes (AI accounts' "Show model") takes
 * `size="sm"`, a 16px box with a 12px tick drawn at an absolute 1.5px stroke and no shadow, so a column of checked boxes
 * reads as small crisp marks. The default checkbox is unchanged.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Checkbox } from '../src/components/ui/checkbox.js'
import { PaletteMath, WARM_STONE } from '../src/theme/palette.ts'

afterEach(cleanup)

const classes = (element: Element | null): readonly string[] => element?.getAttribute('class')?.split(/\s+/u) ?? []

describe('Checkbox size="sm" (council round 11 A5)', () => {
  it('is a 16px box with a 12px tick at an absolute 1.5px stroke, and no shadow', () => {
    const view = render(<Checkbox aria-label="Show gpt-6-luna in the picker" size="sm" checked />)
    const box = view.getByRole('checkbox')
    expect(box.getAttribute('data-size')).toBe('sm')
    expect(classes(box)).toContain('dshx:size-4')
    expect(classes(box)).not.toContain('dshx:shadow-xs')
    const tick = box.querySelector('svg')!
    expect(tick.getAttribute('width')).toBe('12')
    expect(tick.getAttribute('height')).toBe('12')
    // lucide scales the stroke with the 24-unit viewBox: 3 units on a 12px glyph is 1.5px on screen.
    expect(Number(tick.getAttribute('stroke-width')) * (12 / 24)).toBe(1.5)
  })

  it('leaves the default checkbox as it was', () => {
    const view = render(<Checkbox aria-label="Agree" checked />)
    const box = view.getByRole('checkbox')
    expect(box.getAttribute('data-size')).toBe('default')
    expect(classes(box)).toEqual(expect.arrayContaining(['dshx:size-4', 'dshx:shadow-xs']))
    expect(classes(box.querySelector('svg'))).toContain('dshx:size-3.5')
    expect(classes(box)).toEqual(expect.arrayContaining(['dshx:data-[state=checked]:bg-control-on', 'dshx:data-[state=checked]:border-control-on']))
    expect(classes(box).join(' ')).not.toContain('control-on-dense')
  })
})

describe('dense checkbox ink (council round 12 A3)', () => {
  const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
  const block = (selector: string): string => {
    const start = roles.indexOf(`${selector} {`)
    return start < 0 ? '' : roles.slice(start, roles.indexOf('}', start))
  }

  it('fills a checked dense checkbox with the dense on state instead of the full ink', () => {
    const box = render(<Checkbox aria-label="Show gpt-6-luna in the picker" size="sm" checked />).getByRole('checkbox')
    expect(classes(box)).toEqual(expect.arrayContaining(['dshx:data-[state=checked]:bg-control-on-dense', 'dshx:data-[state=checked]:border-control-on-dense']))
    expect(classes(box)).not.toContain('dshx:data-[state=checked]:bg-control-on')
    expect(classes(box)).not.toContain('dshx:data-[state=checked]:border-control-on')
  })

  it('is oklch(0.38 0.008 65) in light, from the ink\'s own hue; dark keeps the dark on state', () => {
    expect(roles).toContain('--color-control-on-dense: var(--dshx-control-on-dense, var(--dshx-control-on, var(--dsw-alias-label-primary)));')
    expect(block('  body')).toContain('--dshx-control-on-dense: oklch(from var(--dsw-alias-label-primary) 0.38 calc(c * 3.2) h);')
    expect(block('  body[data-ds-dark-theme]')).toContain('--dshx-control-on-dense: var(--dshx-control-on);')
    const ink = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' }).neutral[10]!
    expect({ l: 0.38, c: Number((ink.c * 3.2).toFixed(4)), h: ink.h }).toEqual({ l: 0.38, c: 0.008, h: 65 })
  })

  it('holds the fill at 3:1 on bg, panel, raised and the selection wash and the tick at 4.5:1 on it (light)', () => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' })
    const fill = { l: 0.38, c: 0.008, h: 65 }
    for (const [surface, under] of Object.entries({ bg: p.neutral[0]!, panel: p.neutral[1]!, raised: p.neutral[2]!, selected: p.selectedWash, nav: p.navSurface }))
      expect(PaletteMath.contrastRatio(fill, under), `fill on ${surface}`).toBeGreaterThanOrEqual(3)
    expect(PaletteMath.contrastRatio(p.neutral[0]!, fill), 'tick on the fill').toBeGreaterThanOrEqual(4.5)
    // Visibly lighter than the full ink, so a column of checked boxes stops reading as black squares.
    expect(PaletteMath.contrastRatio(fill, p.neutral[10]!)).toBeGreaterThan(1.4)
  })
})
