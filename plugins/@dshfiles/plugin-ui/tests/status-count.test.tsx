// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusCount } from '../src/components/work-status.js'

afterEach(cleanup)

const classes = (element: Element | null): readonly string[] => (element?.getAttribute('class') ?? '').split(/\s+/)

describe('StatusCount (round five A6)', () => {
  it('draws the status glyph at 10px beside a tabular count, so the count reads without its colour', () => {
    const view = render(<StatusCount status="needs-you" count={3} />)
    const chip = view.container.querySelector('[data-slot="status-count"]')!
    expect(chip.getAttribute('data-status')).toBe('needs-you')
    expect(classes(chip)).toEqual(expect.arrayContaining(['dshx:tabular-nums', 'dshx:rounded-full', 'dshx:bg-attention-tint', 'dshx:text-attention-foreground']))
    const glyph = chip.querySelector('[data-slot="status-glyph"]')!
    expect(glyph.getAttribute('aria-hidden')).toBe('true')
    expect(classes(glyph)).toContain('dshx:size-2.5')
    expect(classes(glyph.querySelector('svg'))).toContain('dshx:size-2.5')
    // Screen readers hear the number and the state, once.
    expect(chip.textContent).toBe('3 Needs you')
    expect(view.getByText('Needs you').className).toContain('dshx:sr-only')
  })

  it('takes the danger tint for Failed and a neutral chip for the other states', () => {
    const failed = render(<StatusCount status="failed" count={2} label="2 failed threads" />)
    const chip = failed.container.querySelector('[data-slot="status-count"]')!
    expect(classes(chip)).toEqual(expect.arrayContaining(['dshx:bg-danger-tint', 'dshx:text-danger-tint-foreground']))
    expect(chip.textContent).toBe('2 failed threads')
    expect(classes(chip.querySelector('[data-slot="status-glyph"] svg'))).toContain('dshx:size-2.5')
    cleanup()

    const ready = render(<StatusCount status="ready" count={4} />)
    const readyChip = ready.container.querySelector('[data-slot="status-count"]')!
    expect(classes(readyChip)).toEqual(expect.arrayContaining(['dshx:bg-muted', 'dshx:text-muted-foreground']))
    // The ready dot keeps its own 10px size: it already is the small mark.
    expect(readyChip.querySelector('[data-glyph-mark] > span')?.className).toContain('dshx:size-1.5')
  })

  it('draws nothing for a zero (DESIGN.md › Layout › Counts)', () => {
    const view = render(<StatusCount status="needs-you" count={0} />)
    expect(view.container.querySelector('[data-slot="status-count"]')).toBeNull()
  })
})
