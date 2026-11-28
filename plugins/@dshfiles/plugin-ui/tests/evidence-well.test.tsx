// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EvidenceWell } from '../src/components/ui/evidence-well.js'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'

/**
 * The evidence well (council round 16 A1): one recipe for an Inbox card body's evidence ("Runs: <command>",
 * "Error: <line>"), desktop and phone. Full measure, padding 8/12, radius 6, mono 12/18; neutral oklch(0.95 0.004 70)
 * light / oklch(0.24 0.006 70) dark, red-soft oklch(0.96 0.02 25) / oklch(0.26 0.03 25) for an error line. Plainly
 * not a button: no height, no shadow, no border.
 */
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const schemes: readonly Scheme[] = ['light', 'dark']

afterEach(cleanup)

/** The value a block declares for a custom property: `body {` for light, `body[data-ds-dark-theme] {` for dark. */
const declared = (scheme: Scheme, name: string): Oklch => {
  const blockStart = roles.indexOf(scheme === 'light' ? '\n  body {' : '\n  body[data-ds-dark-theme] {')
  const block = roles.slice(blockStart, roles.indexOf('\n  }', blockStart))
  const match = new RegExp(`${name}: oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\);`, 'u').exec(block)
  expect(match, `${name} in the ${scheme} block`).not.toBeNull()
  return { l: Number(match![1]), c: Number(match![2]), h: Number(match![3]) }
}

/** The body of `@utility evidence-well { … }`, up to the closing brace at column 0. */
const utility = (): string => {
  const start = roles.indexOf('@utility evidence-well {')
  expect(start, '@utility evidence-well').toBeGreaterThanOrEqual(0)
  return roles.slice(start, roles.indexOf('\n}', start))
}

describe('evidence well (council round 16 A1)', () => {
  it.each(schemes)('takes the recipe fills (%s)', scheme => {
    expect(declared(scheme, '--dshx-evidence-well')).toEqual(scheme === 'light' ? { l: 0.95, c: 0.004, h: 70 } : { l: 0.24, c: 0.006, h: 70 })
    expect(declared(scheme, '--dshx-evidence-well-danger')).toEqual(scheme === 'light' ? { l: 0.96, c: 0.02, h: 25 } : { l: 0.26, c: 0.03, h: 25 })
  })

  it.each(schemes)('keeps ink and the label inks at AA on both wells (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const neutral = declared(scheme, '--dshx-evidence-well')
    const danger = declared(scheme, '--dshx-evidence-well-danger')
    for (const [name, well] of Object.entries({ neutral, danger })) {
      expect(PaletteMath.contrastRatio(p.neutral[10]!, well), `${name}: ink`).toBeGreaterThanOrEqual(4.5)
      expect(PaletteMath.contrastRatio(p.neutral[9]!, well), `${name}: secondary`).toBeGreaterThanOrEqual(4.5)
    }
    // "Error:" is the danger text tone.
    expect(PaletteMath.contrastRatio(p.danger.fg, danger), 'danger: label').toBeGreaterThanOrEqual(4.5)
  })

  it('is a full-measure block with flush mono text, never a button shape', () => {
    const body = utility()
    for (const rule of ['width: 100%;', 'padding: 8px 12px;', 'border-radius: var(--dsw-radius-sm, 6px);', 'box-shadow: none;', 'border: 0;', 'font-size: 12px;', 'line-height: 18px;', 'text-align: start;'])
      expect(body, rule).toContain(rule)
    expect(body).toContain('background-color: var(--dshx-evidence-well);')
    expect(body).toMatch(/&\[data-tone='danger'\] \{[^}]*background-color: var\(--dshx-evidence-well-danger\);/u)
    // A button has a fixed height and centres its label; a well grows with its text.
    expect(body).not.toMatch(/(?:^|[^-])(?:min-)?height:/mu)
    expect(body).not.toContain('align-items: center')
  })

  it('renders a labelled well in its tone', () => {
    const { container, rerender } = render(<EvidenceWell label="Runs:">node scripts/publish-preview.mjs --env preview</EvidenceWell>)
    const well = container.querySelector('[data-slot="evidence-well"]')!
    expect(well.getAttribute('data-tone')).toBe('neutral')
    expect(well.className).toContain('dshx:evidence-well')
    expect(well.querySelector('[data-evidence-label]')?.textContent).toBe('Runs:')
    expect(well.textContent).toBe('Runs: node scripts/publish-preview.mjs --env preview')
    rerender(
      <EvidenceWell tone="danger" label="Error:" className="dshx:mt-2">
        fetch failed: ECONNRESET
      </EvidenceWell>,
    )
    const danger = container.querySelector('[data-slot="evidence-well"]')!
    expect(danger.getAttribute('data-tone')).toBe('danger')
    expect(danger.className).toContain('dshx:mt-2')
    expect(danger.textContent).toBe('Error: fetch failed: ECONNRESET')
  })
})
