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

  it('is oklch(0.50 0.01 65) in light, from the ink\'s own hue (council round 13 A1)', () => {
    expect(roles).toContain('--color-control-on-dense: var(--dshx-control-on-dense, var(--dshx-control-on, var(--dsw-alias-label-primary)));')
    expect(block('  body')).toContain('--dshx-control-on-dense: oklch(from var(--dsw-alias-label-primary) 0.5 calc(c * 4) h);')
    const ink = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' }).neutral[10]!
    expect({ l: 0.5, c: Number((ink.c * 4).toFixed(4)), h: ink.h }).toEqual({ l: 0.5, c: 0.01, h: 65 })
  })

  it('is oklch(0.68 0.008 65) in dark, from the ink\'s own hue, under the dark tick (council round 14 A3)', () => {
    expect(block('  body[data-ds-dark-theme]')).toContain('--dshx-control-on-dense: oklch(from var(--dsw-alias-label-primary) 0.68 calc(c * 1.6) h);')
    const p = PaletteMath.palette({ ...WARM_STONE, scheme: 'dark' })
    const ink = p.neutral[10]!
    const fill = { l: 0.68, c: Number((ink.c * 1.6).toFixed(4)), h: ink.h }
    expect(fill).toEqual({ l: 0.68, c: 0.008, h: 65 })
    // The box holds 3:1 on every dark surface it sits on, a dialog's lifted fill included.
    for (const [surface, under] of Object.entries({ bg: p.neutral[0]!, panel: p.neutral[1]!, raised: p.neutral[2]!, selected: p.selectedWash, nav: p.navSurface, dialog: { l: 0.3, c: 0.006, h: 60 } }))
      expect(PaletteMath.contrastRatio(fill, under), `fill on ${surface}`).toBeGreaterThanOrEqual(3)
    // The tick is the dark inverse ink (`control-on-foreground`, step 0), 4.5:1 on the fill.
    const box = render(<Checkbox aria-label="Show gpt-6-luna in the picker" size="sm" checked />).getByRole('checkbox')
    expect(classes(box)).toContain('dshx:data-[state=checked]:text-control-on-foreground')
    // The dark variant of the default fill outranks a plain one, so the dense box names its own dark fill.
    expect(classes(box)).toContain('dshx:dark:data-[state=checked]:bg-control-on-dense')
    expect(classes(box)).not.toContain('dshx:dark:data-[state=checked]:bg-control-on')
    expect(PaletteMath.contrastRatio(p.neutral[0]!, fill), 'tick on the fill').toBeGreaterThanOrEqual(4.5)
  })

  it('holds the fill at 3:1 on bg, panel, raised, nav and the selection wash and the white tick at 4.5:1 on it (light)', () => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme: 'light' })
    const fill = { l: 0.5, c: 0.01, h: 65 }
    for (const [surface, under] of Object.entries({ bg: p.neutral[0]!, panel: p.neutral[1]!, raised: p.neutral[2]!, selected: p.selectedWash, nav: p.navSurface }))
      expect(PaletteMath.contrastRatio(fill, under), `fill on ${surface}`).toBeGreaterThanOrEqual(3)
    // The tick is the inverse ink (step 0, the kit's white).
    expect(PaletteMath.contrastRatio(p.neutral[0]!, fill), 'tick on the fill').toBeGreaterThanOrEqual(4.5)
    // Clearly lighter than the full ink, so a column of checked boxes reads as light marks, not dark squares.
    expect(PaletteMath.contrastRatio(fill, p.neutral[10]!)).toBeGreaterThan(2.5)
  })
})

describe('indeterminate checkbox (a partial tools-tree group)', () => {
  it('fills like a checked box on the on-state tokens and draws a dash instead of the tick', () => {
    const box = render(<Checkbox aria-label="DSH group" checked="indeterminate" />).getByRole('checkbox')
    expect(box.getAttribute('data-state')).toBe('indeterminate')
    expect(box.getAttribute('aria-checked')).toBe('mixed')
    expect(classes(box)).toEqual(
      expect.arrayContaining(['dshx:group', 'dshx:data-[state=indeterminate]:bg-control-on', 'dshx:data-[state=indeterminate]:text-control-on-foreground', 'dshx:dark:data-[state=indeterminate]:bg-control-on']),
    )
    expect(classes(box).join(' ')).not.toContain('bg-primary')
    const [tick, dash] = [...box.querySelectorAll('svg')]
    expect(classes(tick ?? null)).toContain('dshx:group-data-[state=indeterminate]:hidden')
    expect(classes(dash ?? null)).toEqual(expect.arrayContaining(['dshx:hidden', 'dshx:group-data-[state=indeterminate]:block']))
  })

  it('keeps the dense fill and the 12px marks for a partial dense box', () => {
    const box = render(<Checkbox aria-label="Group" size="sm" checked="indeterminate" />).getByRole('checkbox')
    expect(classes(box)).toEqual(expect.arrayContaining(['dshx:data-[state=indeterminate]:bg-control-on-dense', 'dshx:dark:data-[state=indeterminate]:bg-control-on-dense']))
    for (const mark of box.querySelectorAll('svg')) expect(mark.getAttribute('width')).toBe('12')
  })
})
