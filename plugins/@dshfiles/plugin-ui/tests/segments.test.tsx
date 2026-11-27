// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SlidingSegments } from '../src/components/motion/sliding-segments.js'
import { Page } from '../src/components/page.js'
import { Tabs, TabsList, TabsTrigger } from '../src/components/ui/tabs.js'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

afterEach(cleanup)

const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const classes = (element: Element | null): readonly string[] => element?.className.split(/\s+/u) ?? []
const schemes: readonly Scheme[] = ['light', 'dark']
/** `over` at its alpha on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const composite = (under: Oklch, over: Oklch): Oklch => {
  const alpha = over.alpha ?? 1
  const channels = (color: Oklch): readonly number[] =>
    PaletteMath.toHex(color)
      .slice(1)
      .match(/../gu)!
      .map(pair => Number.parseInt(pair, 16))
  const [u, o] = [channels(under), channels(over)]
  return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + o[i]! * alpha).toString(16).padStart(2, '0')).join('')}`)
}

describe('one selected segment (council round 10 A3)', () => {
  it.each(schemes)('is paper on #EBE9E7 in light and a raised #302C28 on #23201D in dark, ink AA on it (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // The track is the raised step (`bg-muted`), the thumb paper or the raised #302C28.
    expect(PaletteMath.toHex(p.neutral[2]!)).toBe(scheme === 'light' ? '#ebe9e7' : '#23201d')
    expect(PaletteMath.toHex(p.segmentThumb)).toBe(scheme === 'light' ? '#fefcfa' : '#302c28')
    const block = ThemeCss.blockDeclarations(WARM_STONE, scheme)
    expect(block).toContain(`  --dshx-segment-thumb: ${PaletteMath.toCss(p.segmentThumb)};`)
    expect(block).toContain(`  --dshx-segment-edge: ${PaletteMath.toCss(p.segmentEdge)};`)
    // The selected label (ink) on the thumb, an unselected one (secondary) on the track.
    expect(PaletteMath.contrastRatio(p.neutral[10]!, p.segmentThumb)).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.neutral[9]!, p.neutral[2]!)).toBeGreaterThanOrEqual(4.5)
    // A quiet edge: a step off the thumb, nowhere near the 3:1 field edge.
    const edge = composite(p.segmentThumb, p.segmentEdge)
    expect(Math.abs(edge.l - p.segmentThumb.l)).toBeGreaterThan(0.02)
    expect(PaletteMath.contrastRatio(edge, p.segmentThumb)).toBeLessThan(1.6)
  })

  it('is one utility: the edge colour, a 6px radius and the thumb fill, no shadow', () => {
    const rule = /@utility segment-thumb \{([^}]*)\}/u.exec(roles)?.[1] ?? ''
    expect(rule).toContain('border-color: var(--dshx-segment-edge, var(--dsw-alias-border-l2));')
    expect(rule).toContain('border-radius: var(--dsw-radius-sm, 6px);')
    expect(rule).toContain('background-color: var(--dshx-segment-thumb, var(--dsw-alias-bg-base));')
    expect(rule).toContain('box-shadow: none;')
    const label = /@utility segment-label \{([\s\S]*?)\n\}/u.exec(roles)?.[1] ?? ''
    expect(label).toContain("content: attr(data-label) / '';")
    expect(label).toContain('font-weight: 550;')
    expect(label).toContain('height: 0;')
  })

  it('paints the kit segmented Tabs with it, the label at 550 and its width reserved', () => {
    const view = render(
      <Tabs value="a">
        <TabsList aria-label="View">
          <TabsTrigger value="a">Needs you</TabsTrigger>
          <TabsTrigger value="b">All</TabsTrigger>
        </TabsList>
      </Tabs>,
    )
    const tab = view.getByRole('tab', { name: 'Needs you' })
    expect(classes(tab)).toEqual(
      expect.arrayContaining(['dshx:group-data-[variant=default]/tabs-list:data-[state=active]:segment-thumb', 'dshx:group-data-[variant=default]/tabs-list:data-[state=active]:font-selected']),
    )
    expect(tab.className).not.toMatch(/shadow-sm|dark:data-\[state=active\]:bg-input|dark:data-\[state=active\]:border-input|data-\[state=active\]:bg-background/u)
    const label = tab.querySelector('[data-slot="segment-label"]')!
    expect(label.getAttribute('data-label')).toBe('Needs you')
    expect(classes(label)).toContain('dshx:segment-label')
    expect(classes(view.getByRole('tablist'))).toEqual(expect.arrayContaining(['dshx:bg-segment-track', 'dshx:p-[3px]']))
  })

  it('springs the page tab indicator in the same thumb', () => {
    const view = render(
      <Page heading="Inbox" tabs={{ label: 'View', value: 'a', onValueChange: () => undefined, items: [{ value: 'a', label: 'Needs you', count: 3 }, { value: 'b', label: 'All' }] }}>
        body
      </Page>,
    )
    const list = view.getByRole('tablist')
    const indicator = list.parentElement!.querySelector('span[aria-hidden]')!
    expect(classes(indicator)).toEqual(expect.arrayContaining(['dshx:border', 'dshx:segment-thumb']))
    expect(indicator.className).not.toMatch(/shadow-sm|bg-input|bg-background/u)
    expect(view.getByRole('tab', { name: /Needs you/u }).querySelector('[data-label="Needs you"]')).not.toBeNull()
  })

  it('draws SlidingSegments in it, inset 3px in the raised track at the same 32px height', () => {
    const view = render(<SlidingSegments aria-label="Metric" value="cost" onValueChange={() => undefined} options={[{ value: 'cost', label: 'Cost' }, { value: 'tokens', label: 'Tokens' }]} />)
    const root = view.getByRole('radiogroup')
    expect(classes(root)).toEqual(expect.arrayContaining(['dshx:bg-segment-track', 'dshx:p-0.75', 'dshx:rounded-lg']))
    const pill = root.querySelector('span[aria-hidden]')!
    expect(classes(pill)).toEqual(expect.arrayContaining(['dshx:border', 'dshx:segment-thumb', 'dshx:inset-y-0.75']))
    expect(pill.className).not.toMatch(/shadow-xs|ring-1|bg-background/u)
    const cost = view.getByRole('radio', { name: 'Cost' })
    // 26px items + 2 x 3px inset = the 32px it was (28 + 2 x 2).
    expect(classes(cost)).toEqual(expect.arrayContaining(['dshx:h-6.5', 'dshx:aria-checked:font-selected', 'dshx:aria-checked:text-foreground']))
    expect(cost.querySelector('[data-label="Cost"]')).not.toBeNull()
  })
})

// Council round 28, item 14: the dark thumb was a hair off its track (1.10:1 against a popover of the same step). The dark
// track drops to #1A1715 and the thumb's edge to an opaque #4D4843, so the chosen segment reads at a glance; light keeps
// the raised #EBE9E7 track.
describe('the segment track (council round 28, item 14)', () => {
  it.each(schemes)('is its own token, #EBE9E7 in light and #1A1715 in dark, with the dark edge at #4D4843 (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(PaletteMath.toHex(p.segmentTrack)).toBe(scheme === 'light' ? '#ebe9e7' : '#1a1715')
    if (scheme === 'dark') expect(PaletteMath.toHex(p.segmentEdge)).toBe('#4d4843')
    // Secondary labels stay AA on the track; the thumb and its edge stand off it.
    expect(PaletteMath.contrastRatio(p.neutral[9]!, p.segmentTrack)).toBeGreaterThanOrEqual(4.5)
    expect(ThemeCss.themeCss()).toContain(`--dshx-segment-track: ${PaletteMath.toCss(p.segmentTrack)};`)
  })

  it('paints the kit segmented Tabs and SlidingSegments tracks with it', () => {
    const tabs = readFileSync(join(process.cwd(), 'src/components/ui/tabs.tsx'), 'utf8')
    const sliding = readFileSync(join(process.cwd(), 'src/components/motion/sliding-segments.tsx'), 'utf8')
    expect(tabs).toContain("default: 'dshx:bg-segment-track dshx:group-data-[orientation=horizontal]/tabs:h-(--dshx-control-h)'")
    expect(sliding).toContain('dshx:bg-segment-track')
  })
})
