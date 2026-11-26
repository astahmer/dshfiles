// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Checkbox } from '../src/components/ui/checkbox.js'
import { RadioGroup, RadioGroupItem } from '../src/components/ui/radio-group.js'
import { Switch } from '../src/components/ui/switch.js'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

afterEach(cleanup)

const classes = (element: Element | null): readonly string[] => (element?.getAttribute('class') ?? '').split(/\s+/)

/**
 * DESIGN.md › Colour roles 6: the on state of a switch, checkbox or radio is `control-on`, the ink since council round 7
 * A1 (indigo means attention, focus and links only), with its tick in `control-on-foreground`.
 */
describe('control on state', () => {
  it('fills a checked switch track with control-on and keeps a full-size background knob in dark', () => {
    const view = render(<Switch checked onCheckedChange={() => undefined} aria-label="On" />)
    const track = classes(view.container.querySelector('[data-slot="switch"]'))
    expect(track).toContain('dshx:data-[state=checked]:bg-control-on')
    expect(track.join(' ')).not.toMatch(/checked\]:bg-primary\b/)
    // Only the colours and the knob move, in the 120ms fade, never `transition-all` (layout would animate too).
    expect(track).not.toContain('dshx:transition-all')
    expect(track).toContain('dshx:transition-[background-color,transform]')
    expect(track).toContain('dshx:duration-(--dshx-duration-fade)')
    const knob = classes(view.container.querySelector('[data-slot="switch-thumb"]'))
    expect(knob).toContain('dshx:bg-background')
    expect(knob.join(' ')).not.toMatch(/scale-75|checked\]:bg-primary-foreground/)
    expect(knob).toContain('dshx:duration-(--dshx-duration-fade)')
  })

  it('fills a checked checkbox with control-on in both schemes', () => {
    const view = render(<Checkbox checked aria-label="On" />)
    const box = classes(view.container.querySelector('[data-slot="checkbox"]'))
    expect(box).toEqual(expect.arrayContaining(['dshx:data-[state=checked]:border-control-on', 'dshx:data-[state=checked]:bg-control-on', 'dshx:dark:data-[state=checked]:bg-control-on']))
    expect(box.join(' ')).not.toMatch(/checked\]:(?:bg|border)-primary\b/)
    // The tick is the inverse of the ink: white in light, the dark background in dark.
    expect(box).toContain('dshx:data-[state=checked]:text-control-on-foreground')
    expect(box).not.toContain('dshx:data-[state=checked]:text-primary-foreground')
    expect(box).toContain('dshx:duration-(--dshx-duration-fade)')
  })

  it('draws a checked radio in control-on', () => {
    const view = render(
      <RadioGroup value="a" aria-label="Pick">
        <RadioGroupItem value="a" aria-label="A" />
      </RadioGroup>,
    )
    const item = classes(view.container.querySelector('[data-slot="radio-group-item"]'))
    expect(item).toEqual(expect.arrayContaining(['dshx:text-control-on', 'dshx:data-[state=checked]:border-control-on']))
    expect(item).not.toContain('dshx:text-primary')
    const dot = view.container.querySelector('[data-slot="radio-group-indicator"] svg')
    expect(classes(dot)).toContain('dshx:fill-control-on')
  })
})

describe('control on contrast (council round 7 A1, dark at L 0.82 since council round 9 A2)', () => {
  const schemes: readonly Scheme[] = ['light', 'dark']
  const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
  const block = (selector: string): string => {
    const start = roles.indexOf(`${selector} {`)
    return start < 0 ? '' : roles.slice(start, roles.indexOf('}', start))
  }

  it('reads the on state from a kit variable: the ink in light, the ink\'s hue at L 0.82 in dark', () => {
    expect(roles).toContain('--color-control-on: var(--dshx-control-on, var(--dsw-alias-label-primary));')
    expect(roles).toContain('--color-control-on-foreground: var(--dshx-control-on-foreground, var(--dsw-alias-label-primary-foreground));')
    expect(block('  body')).toContain('--dshx-control-on: var(--dsw-alias-label-primary);')
    expect(block('  body')).toContain('--dshx-control-on-foreground: var(--dsw-alias-label-primary-foreground);')
    expect(block('  body[data-ds-dark-theme]')).toContain('--dshx-control-on: oklch(from var(--dsw-alias-label-primary) 0.82 c h);')
    expect(block('  body[data-ds-dark-theme]')).toContain('--dshx-control-on-foreground: var(--dsw-alias-label-primary-foreground);')
  })

  it.each(schemes)('holds the fill at 3:1 on bg, panel, raised and the selection wash, the tick and knob at 3:1 on the fill (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // `--dsw-alias-label-primary` is step 10, `-foreground` step 0 and `--dsw-alias-bg-base` step 0 (theme-css.ts).
    // Dark steps the ink down to L 0.82 at its own hue and chroma: no near-white glare.
    const fill = scheme === 'light' ? p.neutral[10]! : { ...p.neutral[10]!, l: 0.82 }
    const tick = p.neutral[0]!
    for (const [surface, under] of Object.entries({ bg: p.neutral[0]!, panel: p.neutral[1]!, raised: p.neutral[2]!, selected: p.selectedWash }))
      expect(PaletteMath.contrastRatio(fill, under), `fill on ${surface}`).toBeGreaterThanOrEqual(3)
    expect(PaletteMath.contrastRatio(tick, fill), 'tick and knob on the fill').toBeGreaterThanOrEqual(3)
    expect(PaletteMath.toHex(fill)).toBe(scheme === 'light' ? '#1b1a19' : '#c6c3c1')
    if (scheme === 'dark') expect(PaletteMath.contrastRatio(fill, p.neutral[10]!), 'visibly below the ink').toBeGreaterThan(1.3)
    expect(PaletteMath.toHex(tick)).toBe(scheme === 'light' ? '#fefcfa' : '#15120f')
    const block = ThemeCss.blockDeclarations(WARM_STONE, scheme).join('\n')
    expect(block).toContain('--dsw-alias-label-primary: var(--dshx-tone-10);')
    expect(block).toContain('--dsw-alias-label-primary-foreground: var(--dshx-tone-0);')
  })
})
