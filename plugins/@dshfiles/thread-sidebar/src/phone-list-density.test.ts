import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const client = readFileSync(new URL('client.tsx', import.meta.url), 'utf8')

describe('phone thread list density (council round 4 B4)', () => {
  it('stands groups 12px apart on touch (the last row gap and 6px), 20px with a mouse', () => {
    expect(client).toContain("'dshx:not-pointer-coarse:not-first:mt-3.5 dshx:pointer-coarse:not-first:mt-1.5'")
  })

  it('draws phone rows as 56pt two-line targets, so the first Ready row shows above the tab bar', () => {
    expect(client).toContain("'dshx:pointer-coarse:min-h-14 dshx:pointer-coarse:justify-center'")
  })

  it('keeps the time, the verb and a subagent row time in one trailing column, left of the row menu', () => {
    // The row reserves 44px for its menu button; the verb and a child row end at that same edge.
    expect(client).toContain("'dshx:pointer-coarse:pr-11'")
    expect(client).toContain("'dshx:bottom-1.5', 'dshx:pointer-coarse:right-11'")
    expect(client).toContain("verbSeat === 'head' && 'dshx:pointer-coarse:right-11'")
    expect(client).not.toContain('dshx:pointer-coarse:right-10')
  })
})
