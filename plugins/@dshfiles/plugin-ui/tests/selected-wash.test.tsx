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

describe('selected wash (round five K2, quieter in A1)', () => {
  it.each(schemes)('is a soft accent tint generated from the accent hue (%s)', scheme => {
    const { selectedWash } = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(selectedWash).toEqual(scheme === 'light' ? { l: 0.955, c: 0.012, h: 270 } : { l: 0.255, c: 0.022, h: 270 })
    expect(PaletteMath.palette({ ...WARM_STONE, accentHue: 150, scheme }).selectedWash.h).toBe(150)
  })

  it.each(schemes)('keeps ink and secondary text at AA and every glyph at 3:1 on it (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const wash = p.selectedWash
    for (const step of [9, 10]) expect(PaletteMath.contrastRatio(p.neutral[step]!, wash), `step ${step}`).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.neutral[8]!, wash), 'faint').toBeGreaterThanOrEqual(4.5)
    for (const key of ['accent', 'danger', 'success', 'warning'] as const) expect(PaletteMath.contrastRatio(p[key].fg, wash), key).toBeGreaterThanOrEqual(3)
  })

  it.each(schemes)('sits below the Needs-you and Failed washes (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const wash of [p.needsYouWash, p.failedWash]) {
      expect(wash.c).toBeGreaterThan(p.selectedWash.c)
      // Further from the page than the selection: a Needs-you row stands out more than the selected one.
      const bg = p.neutral[0]!
      expect(PaletteMath.contrastRatio(wash, bg)).toBeGreaterThanOrEqual(PaletteMath.contrastRatio(p.selectedWash, bg))
    }
  })

  it('is emitted in both theme blocks and exposed as the selected-wash colour', () => {
    const light = ThemeCss.blockDeclarations(WARM_STONE, 'light').join('\n')
    const dark = ThemeCss.blockDeclarations(WARM_STONE, 'dark').join('\n')
    expect(light).toContain('--dshx-selected-wash: oklch(0.955 0.012 270);')
    expect(dark).toContain('--dshx-selected-wash: oklch(0.255 0.022 270);')
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

  it('marks a selection without colour: a 2px accent bar inset on the leading edge, and 550 text', () => {
    const marker = /@utility selected-marker\s*\{([^}]*)\}/u.exec(roles)?.[1] ?? ''
    expect(marker).toContain('box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary);')
    expect(roles).toContain('--font-weight-selected: 550;')
    // An unselected row draws neither.
    const view = render(<EntityRow heading="Fix invoice tax rounding" onSelect={() => undefined} />)
    expect(view.container.querySelector('[data-slot="entity-row"]')!.className).not.toContain('selected-marker')
    expect(view.container.querySelector('[data-slot="entity-row-title"]')!.className).not.toContain('font-selected')
  })

  it.each(schemes)('draws the marker at 3:1 on the selection wash (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(PaletteMath.contrastRatio(p.accent.fg, p.selectedWash)).toBeGreaterThanOrEqual(3)
  })
})
