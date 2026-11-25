// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AttentionBadge } from '../src/components/ui/attention-badge.js'
import { PaletteMath, WARM_STONE, type Oklch } from '../src/theme/palette.ts'

afterEach(cleanup)

// Vitest runs each package from its root.
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const block = (selector: string): string => {
  const start = roles.indexOf(`${selector} {`)
  return start < 0 ? '' : roles.slice(start, roles.indexOf('}', start))
}
const classes = (element: Element | null): readonly string[] => (element?.getAttribute('class') ?? '').split(/\s+/)

describe('AttentionBadge (council round 4 A3)', () => {
  it('draws the count in a 16px attention pill with a spoken label, and nothing for a zero', () => {
    const view = render(<AttentionBadge count={3} label="need you" />)
    const badge = view.container.querySelector('[data-slot="attention-badge"]')!
    expect(classes(badge)).toEqual(expect.arrayContaining(['dshx:badge-attention']))
    expect(badge.textContent).toBe('3 need you')
    expect(view.getByText('need you').className).toContain('dshx:sr-only')
    cleanup()
    expect(render(<AttentionBadge count={0} />).container.firstChild).toBeNull()
    cleanup()
    expect(render(<AttentionBadge count={140} />).container.textContent).toBe('99+ Needs you')
  })

  it('is a 16px pill with tabular figures and a 2px ring in the rail surface colour', () => {
    const utility = /@utility badge-attention \{([\s\S]*?)\n\}/u.exec(roles)?.[1] ?? ''
    expect(utility).toContain('height: 16px;')
    expect(utility).toContain('min-width: 16px;')
    expect(utility).toContain('border-radius: 9999px;')
    expect(utility).toContain('font-variant-numeric: tabular-nums;')
    expect(utility).toContain('background-color: var(--dshx-badge-attention-fill);')
    expect(utility).toContain('color: var(--dshx-badge-attention-foreground);')
    expect(utility).toContain('box-shadow: 0 0 0 2px var(--dshx-badge-ring, var(--dsw-specific-sidebar-fill));')
  })

  it('takes the Needs-you fill with white text in light, a lifted fill with dark text in dark', () => {
    expect(block('  body')).toContain('--dshx-badge-attention-fill: var(--dsw-alias-state-business-primary);')
    expect(block('  body')).toContain('--dshx-badge-attention-foreground: oklch(1 0 0);')
    const dark = block('  body[data-ds-dark-theme]')
    expect(dark).toContain('--dshx-badge-attention-fill: oklch(from var(--dsw-alias-state-business-primary) 0.72 0.14 h);')
    expect(dark).toContain('--dshx-badge-attention-foreground: oklch(from var(--dsw-alias-state-business-primary) 0.2 0.02 h);')
  })

  it.each(['light', 'dark'] as const)('holds AA text on its fill and 3:1 against the rail it rings (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const hue = WARM_STONE.accentHue
    const fill: Oklch = scheme === 'light' ? p.accent.fg : { l: 0.72, c: 0.14, h: hue }
    const text: Oklch = scheme === 'light' ? { l: 1, c: 0, h: 0 } : { l: 0.2, c: 0.02, h: hue }
    expect(PaletteMath.contrastRatio(text, fill)).toBeGreaterThanOrEqual(4.5)
    for (const step of [0, 1, 2]) expect(PaletteMath.contrastRatio(fill, p.neutral[step]!), `fill on step ${step}`).toBeGreaterThanOrEqual(3)
  })
})
