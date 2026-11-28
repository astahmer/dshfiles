// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DiffStat } from '../src/components/diff-stat.js'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'

afterEach(cleanup)

const schemes: readonly Scheme[] = ['light', 'dark']
const classes = (element: Element | null): readonly string[] => element?.className.split(/\s+/u) ?? []

describe('DiffStat (council round 3 A6)', () => {
  it('reads +N then −N, with a real minus sign, in sans tabular 12px', () => {
    const view = render(<DiffStat added={48} removed={3} />)
    const stat = view.container.querySelector('[data-slot="diff-stat"]')!
    const [added, removed] = [...stat.querySelectorAll('[data-diff-side]')]
    expect(added?.getAttribute('data-diff-side')).toBe('added')
    expect(added?.textContent).toBe('+48')
    expect(removed?.getAttribute('data-diff-side')).toBe('removed')
    expect(removed?.textContent).toBe('\u22123')
    expect(classes(stat)).toEqual(expect.arrayContaining(['dshx:font-sans', 'dshx:tabular-nums', 'dshx:text-xs']))
    expect(classes(added!)).toContain('dshx:text-success')
    expect(classes(removed!)).toContain('dshx:text-destructive')
  })

  it('always draws both sides, a zero side muted instead of coloured', () => {
    const view = render(<DiffStat added={12} removed={0} />)
    const removed = view.container.querySelector('[data-diff-side="removed"]')!
    expect(removed.textContent).toBe('\u22120')
    expect(classes(removed)).toContain('dshx:text-muted-foreground')
    expect(classes(removed)).not.toContain('dshx:text-destructive')
  })

  it('says the change in words to a screen reader and hides the signs', () => {
    const view = render(<DiffStat added={1} removed={2400} />)
    const stat = view.container.querySelector('[data-slot="diff-stat"]')!
    expect(stat.querySelector('.dshx\\:sr-only')?.textContent).toBe('1 line added, 2,400 lines removed')
    expect(stat.querySelector('[data-diff-side="removed"]')?.textContent).toBe('\u22122,400')
    expect(stat.querySelector('[aria-hidden="true"]')).not.toBeNull()
    cleanup()
    const labelled = render(<DiffStat added={1} removed={2} label="Since you left: 1 added, 2 removed" />)
    expect(labelled.container.querySelector('.dshx\\:sr-only')?.textContent).toBe('Since you left: 1 added, 2 removed')
  })

  it('passes className and span props through', () => {
    const view = render(<DiffStat added={1} removed={1} className="dshx:ml-auto" id="stat" />)
    const stat = view.container.querySelector('#stat')!
    expect(classes(stat)).toContain('dshx:ml-auto')
  })

  it.each(schemes)('holds AA for both colours on bg, panel, raised and the selected wash (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const under of [p.neutral[0]!, p.neutral[1]!, p.neutral[2]!, p.selectedWash])
      for (const key of ['success', 'danger'] as const) expect(PaletteMath.contrastRatio(p[key].fg, under), `${key} on ${PaletteMath.toCss(under)}`).toBeGreaterThanOrEqual(4.5)
  })
})
