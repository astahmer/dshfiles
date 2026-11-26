// @vitest-environment jsdom
/**
 * The dense checkbox (council round 11 A5): a table column of checkboxes (AI accounts' "Show model") takes
 * `size="sm"`, a 16px box with a 12px tick drawn at an absolute 1.5px stroke and no shadow, so a column of checked boxes
 * reads as small crisp marks. The default checkbox is unchanged.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Checkbox } from '../src/components/ui/checkbox.js'

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
  })
})
