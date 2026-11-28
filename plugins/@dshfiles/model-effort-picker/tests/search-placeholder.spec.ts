import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PlaceholderFit, SEARCH_PLACEHOLDERS } from '../src/model-effort-picker.js'

describe('the search says what it finds, in the room it has (council picker round 5, U12)', () => {
  it('offers "Search models or accounts…" first, then shorter wordings', () => {
    expect(SEARCH_PLACEHOLDERS).toEqual(['Search models or accounts…', 'Models or accounts…', 'Search…'])
  })

  it('takes the first wording that fits, the shortest when none does', () => {
    expect(PlaceholderFit.pick({ room: 220, widths: [209, 150, 60] })).toBe(0)
    expect(PlaceholderFit.pick({ room: 160, widths: [209, 150, 60] })).toBe(1)
    expect(PlaceholderFit.pick({ room: 40, widths: [209, 150, 60] })).toBe(2)
  })

  it('reserves Clear search room only while there is a query', () => {
    const picker = readFileSync(new URL('../src/model-effort-picker.tsx', import.meta.url), 'utf8')
    expect(picker).toContain("query !== '' && 'dshx:[&_input]:pr-8 dshx:pointer-coarse:[&_input]:pr-11'")
    expect(picker).toContain('placeholder={placeholder}')
  })
})
