// @vitest-environment jsdom
/**
 * The bar text button (council round 13 A4): a worded action in a phone top bar (the Inbox's Triage) follows one rule,
 * the secondary label at 500 with a 16px glyph 6px before it, on a 44px seat, so it reads as a control and never as a
 * second title.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button, buttonVariants } from '../src/components/ui/button.js'
import { ListChecksIcon } from '../src/icons.js'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

afterEach(cleanup)

const classesOf = (element: Element): readonly string[] => element.getAttribute('class')?.split(/\s+/u) ?? []

/** `over` at `alpha` on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const composite = (under: Oklch, over: Oklch, alpha: number): Oklch => {
  const channels = (color: Oklch): readonly number[] => [1, 3, 5].map(at => Number.parseInt(PaletteMath.toHex(color).slice(at, at + 2), 16))
  const [u, o] = [channels(under), channels(over)]
  return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + (o[i] ?? 0) * alpha).toString(16).padStart(2, '0')).join('')}`)
}

describe('Button variant="bar" (council round 13 A4)', () => {
  it('is a 44px seat with the secondary label at 500, a 16px glyph and a 6px gap', () => {
    render(
      <Button variant="bar">
        <ListChecksIcon aria-hidden />
        Triage
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Triage' })
    const classes = classesOf(button)
    expect(button.getAttribute('data-variant')).toBe('bar')
    expect(classes).toEqual(expect.arrayContaining(['dshx:h-11', 'dshx:px-3', 'dshx:gap-1.5', 'dshx:text-sm', 'dshx:font-medium', 'dshx:text-muted-foreground']))
    // The 44px seat replaces the control height; the glyph keeps the base 16px.
    expect(classes).not.toContain('dshx:h-(--dshx-control-h)')
    expect(classes).not.toContain('dshx:gap-2')
    expect(classes).toContain('dshx:[&_svg:not([class*=size-])]:size-4')
    // No fill or border at rest: a bar action, not a chip.
    expect(classes.filter(name => /^dshx:(?:bg-|border|shadow)/u.test(name))).toEqual([])
  })

  it('is readable outside Button too, for a trigger that cannot be one', () => {
    expect(buttonVariants({ variant: 'bar' })).toContain('dshx:h-11')
  })

  it.each<Scheme>(['light', 'dark'])('keeps the secondary label AA on the bar and on its hover and press fills (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const label = p.neutral[9]!
    const bar = p.neutral[0]!
    expect(PaletteMath.contrastRatio(label, bar)).toBeGreaterThanOrEqual(4.5)
    // Hover (ink 6% / 7%) turns the label to ink; the press fill (10% / 12%) keeps it ink too.
    expect(PaletteMath.contrastRatio(p.neutral[10]!, composite(bar, p.neutral[10]!, scheme === 'light' ? 0.1 : 0.12))).toBeGreaterThanOrEqual(4.5)
  })
})
