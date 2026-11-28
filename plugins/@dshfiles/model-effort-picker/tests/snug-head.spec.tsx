import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SnugHead } from '../src/picker-atoms.js'

describe('the long-name head ends at its ellipsis (council picker round 6, V12)', () => {
  const measure = (text: string): number => text.length * 7

  it('shrinks a cut head to the width of the characters it keeps and the ellipsis, with nothing left after', () => {
    // 80 px of room: "abcdefghij…" would be 77, "abcdefghijk…" 84; the head draws 77 px, not 80.
    expect(SnugHead.width({ text: 'abcdefghijklmnop', room: 80, measure })).toBe(77)
  })

  it('leaves a head that fits alone', () => {
    expect(SnugHead.width({ text: 'abc', room: 80, measure })).toBeUndefined()
  })

  it('keeps the long-name tooltip inside the list pane', () => {
    expect(readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')).toMatch(/aria-label="Choose a model"\s+data-tooltip-boundary/u)
    expect(readFileSync(new URL('../src/picker-atoms.tsx', import.meta.url), 'utf8')).toContain('{...(boundary === null ? {} : { collisionBoundary: boundary })}')
  })
})
