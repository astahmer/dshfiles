// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EntityRow } from '../src/components/entity-row.js'
import { Command, CommandItem, CommandList } from '../src/components/ui/command.js'
import { toggleVariants } from '../src/components/ui/toggle.js'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** cmdk measures its list; jsdom has no ResizeObserver. */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const schemes: readonly Scheme[] = ['light', 'dark']

describe('selected wash (round five K2, quieter in A1, neutral in council round 3)', () => {
  it.each(schemes)('is a neutral warm wash that ignores the accent hue (%s)', scheme => {
    const { selectedWash } = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(selectedWash).toEqual(scheme === 'light' ? { l: 0.935, c: 0.004, h: 80 } : { l: 0.275, c: 0.006, h: 60 })
    // Indigo fills mean attention only: a different accent leaves the selection unchanged.
    expect(PaletteMath.palette({ ...WARM_STONE, accentHue: 150, scheme }).selectedWash).toEqual(selectedWash)
  })

  it.each(schemes)('keeps ink and secondary text at AA and every glyph at 3:1 on it (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const wash = p.selectedWash
    for (const step of [9, 10]) expect(PaletteMath.contrastRatio(p.neutral[step]!, wash), `step ${step}`).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.neutral[8]!, wash), 'faint').toBeGreaterThanOrEqual(4.5)
    for (const key of ['accent', 'danger', 'success', 'warning'] as const) expect(PaletteMath.contrastRatio(p[key].fg, wash), key).toBeGreaterThanOrEqual(3)
  })

  it.each(schemes)('leaves hue to the Needs-you and Failed washes (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // The selection is a grey step; only attention carries chroma, so a Needs-you row reads as colour and the
    // selected one as a tone (the marker carries the accent).
    expect(p.selectedWash.c).toBeLessThanOrEqual(0.006)
    for (const wash of [p.needsYouWash, p.failedWash]) expect(wash.c).toBeGreaterThanOrEqual(5 * p.selectedWash.c)
  })

  it('is emitted in both theme blocks and exposed as the selected-wash colour', () => {
    const light = ThemeCss.blockDeclarations(WARM_STONE, 'light').join('\n')
    const dark = ThemeCss.blockDeclarations(WARM_STONE, 'dark').join('\n')
    expect(light).toContain('--dshx-selected-wash: oklch(0.935 0.004 80);')
    expect(dark).toContain('--dshx-selected-wash: oklch(0.275 0.006 60);')
    expect(roles).toContain('--color-selected-wash: var(--dshx-selected-wash);')
  })

  it('paints the selected EntityRow, the highlighted command item and a pressed toggle, with ink text', () => {
    const view = render(<EntityRow heading="Fix invoice tax rounding" selected onSelect={() => undefined} />)
    const row = view.container.querySelector('[data-slot="entity-row"]')!
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(['dshx:bg-selected-wash', 'dshx:selected-marker']))
    // Selected text reads at 550: a non-colour cue beside the bar.
    expect(view.container.querySelector('[data-slot="entity-row-title"]')!.className.split(/\s+/)).toContain('dshx:font-selected')
    expect(row.className).not.toMatch(/(?:^| )dshx:bg-accent(?: |$)/)
    cleanup()

    vi.stubGlobal('ResizeObserver', NoopResizeObserver)
    // cmdk scrolls the highlighted item into view; jsdom does not implement it.
    if (!('scrollIntoView' in Element.prototype)) Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => undefined })
    const palette = render(
      <Command>
        <CommandList>
          <CommandItem>Open thread</CommandItem>
        </CommandList>
      </Command>,
    )
    const item = palette.container.querySelector('[data-slot="command-item"]')!
    expect(item.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['dshx:data-[selected=true]:bg-selected-wash', 'dshx:data-[selected=true]:text-foreground', 'dshx:data-[selected=true]:selected-marker']),
    )
    expect(item.className).not.toContain('data-[selected=true]:bg-accent')

    const toggle = toggleVariants().split(/\s+/)
    expect(toggle).toEqual(expect.arrayContaining(['dshx:data-[state=on]:bg-selected-wash', 'dshx:data-[state=on]:text-foreground']))
    expect(toggle.join(' ')).not.toContain('data-[state=on]:bg-accent')
  })

  it('marks a selection without colour: a 2px ink bar inset on the leading edge, and 550 text', () => {
    const marker = /@utility selected-marker\s*\{([^}]*)\}/u.exec(roles)?.[1] ?? ''
    // Indigo means attention only (council round 6 A1): the bar is the ink, never the accent.
    expect(marker).toContain('box-shadow: inset 2px 0 0 var(--dsw-alias-label-primary);')
    expect(marker).not.toContain('business')
    expect(roles).toContain('--font-weight-selected: 550;')
    // An unselected row draws neither.
    const view = render(<EntityRow heading="Fix invoice tax rounding" onSelect={() => undefined} />)
    expect(view.container.querySelector('[data-slot="entity-row"]')!.className).not.toContain('selected-marker')
    expect(view.container.querySelector('[data-slot="entity-row-title"]')!.className).not.toContain('font-selected')
  })

  it.each(schemes)('draws the ink marker at 3:1 on the selection wash, in a colour that is not the accent (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // `--dsw-alias-label-primary` is neutral step 10 (theme-css.ts).
    const ink = p.neutral[10]!
    expect(PaletteMath.contrastRatio(ink, p.selectedWash)).toBeGreaterThanOrEqual(3)
    expect(ink).not.toEqual(p.accent.fg)
    expect(ink.c).toBeLessThan(0.03)
  })
})

describe('selected card (council round 3 A1, round 8 A2)', () => {
  const card = /@utility selected-card\s*\{([\s\S]*?)\n\}/u.exec(roles)?.[1] ?? ''

  it('draws a 1.5px edge in the ink at 80% on the card\'s own surface, with no fill, no inset marker and no layout shift (council round 9 A3)', () => {
    // Council round 8 A2: the edge and the check carry the choice; the card keeps its normal surface.
    expect(card.replace(/&::after\s*\{[^}]*\}/u, '')).not.toMatch(/background/u)
    // A 1px border plus a 0.5px inset ring in the ink at 80%: 1.5px on a bordered card, without changing its box.
    // The control-on ink (council round 7 A1), not the accent: indigo means attention, focus and links only.
    expect(roles).toContain('--color-control-on: var(--dshx-control-on, var(--dsw-alias-label-primary));')
    expect(card).toContain('border-color: color-mix(in oklab, var(--dsw-alias-label-primary) 80%, transparent);')
    expect(card).toContain('box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--dsw-alias-label-primary) 80%, transparent);')
    expect(card).not.toContain('business')
    expect(card).not.toContain('inset 2px 0 0')
    expect(card).not.toMatch(/border-width|padding|margin/u)
  })

  it('shows a check in the corner, drawn in the ring colour, so the choice reads without colour', () => {
    expect(card).toMatch(/&::after\s*\{[^}]*mask[^}]*\}/u)
    expect(card).toMatch(/&::after\s*\{[^}]*background-color: var\(--dsw-alias-label-primary\);/u)
    expect(card).toMatch(/&::after\s*\{[^}]*pointer-events: none;/u)

    // A coarse pointer's 44px hit area (styles.css) also draws with a raw button's ::after and sets all four insets:
    // the badge resets them, so it stays a 16px corner badge instead of stretching to the leading edge.
    expect(card).toMatch(/&::after\s*\{[^}]*inset-block: 6px auto;[^}]*inset-inline: auto 6px;/u)
  })

  it.each(schemes)('holds the check and the edge at 3:1 on every card surface (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // `--dsw-alias-label-primary` is neutral step 10; the check is cut out to the card's own surface.
    for (const step of [0, 1, 2, 3]) expect(PaletteMath.contrastRatio(p.neutral[10]!, p.neutral[step]!), `step ${step}`).toBeGreaterThanOrEqual(3)
    // The edge is the ink at 80% composited over the card surface (sRGB alpha), still 3:1 on every step.
    const over = (top: string, under: string, alpha: number): string =>
      `#${[1, 3, 5].map(at => Math.round(Number.parseInt(top.slice(at, at + 2), 16) * alpha + Number.parseInt(under.slice(at, at + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`
    for (const step of [0, 1, 2, 3]) {
      const surface = PaletteMath.toHex(p.neutral[step]!)
      const edge = PaletteMath.hexToOklch(over(PaletteMath.toHex(p.neutral[10]!), surface, 0.8))
      expect(PaletteMath.contrastRatio(edge, p.neutral[step]!), `edge on step ${step}`).toBeGreaterThanOrEqual(3)
    }
  })
})
