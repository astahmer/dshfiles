import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const client = readFileSync(new URL('client.tsx', import.meta.url), 'utf8')
const header = readFileSync(new URL('thread-group-header.tsx', import.meta.url), 'utf8')
const rows = readFileSync(new URL('virtual-thread-rows.tsx', import.meta.url), 'utf8')

describe('phone thread list density (round five B1)', () => {
  it('stands groups 6px apart on touch (the last row gap and 2px), none above the first, 20px with a mouse', () => {
    expect(client).toContain("'dshx:not-pointer-coarse:not-first:mt-3.5 dshx:pointer-coarse:not-first:mt-0.5 dshx:pointer-coarse:first:mt-0'")
    expect(rows).toContain("const ROW_GAP = 'dshx:pb-1.5 dshx:pointer-coarse:pb-1'")
  })

  it('draws a group header 28px tall on touch, its 44px hit area from the kit', () => {
    expect(header).toContain("'dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:px-2.5 dshx:pointer-coarse:h-7'")
  })

  it('lays a phone row out as two rows 6px apart, at least 52pt tall, so the first Ready row shows above the tab bar', () => {
    expect(client).toContain("'dshx:pointer-coarse:min-h-13 dshx:pointer-coarse:justify-center dshx:pointer-coarse:gap-1.5 dshx:pointer-coarse:py-1'")
    expect(client).not.toContain('dshx:pointer-coarse:min-h-14')
  })

  it('keeps the time, the verb and a subagent row time in one trailing column, left of the row menu', () => {
    // The row reserves 44px for its menu button; the verb and a child row end at that same edge.
    expect(client).toContain("'dshx:pointer-coarse:pr-11'")
    expect(client).toContain("verbSeat === 'head' && 'dshx:pointer-coarse:right-11'")
    expect(client).not.toContain('dshx:pointer-coarse:right-10')
  })

  it('seats a 28px verb in the second row, never against the time on the first', () => {
    // Row 2 is at least the verb's height; the verb sits on the row's bottom padding, so it fills row 2 exactly.
    expect(client).toContain("verbSeat === 'meta' && 'dshx:pointer-coarse:min-h-7'")
    expect(client).toContain("'dshx:pointer-coarse:right-11 dshx:pointer-coarse:bottom-1'")
    expect(client).toContain("className=\"dshx:z-10 dshx:h-6 dshx:px-2 dshx:pointer-coarse:h-7\"")
  })

  it('ends the list in 12px of padding under a 24px fade, so the status bar never cuts the last row hard (round five C5)', () => {
    expect(client).toContain("'dshx:min-h-32 dshx:flex-1 dshx:overflow-auto dshx:overscroll-y-contain dshx:px-2 dshx:pb-3 dshx:[mask-image:linear-gradient(to_bottom,#000_calc(100%-24px),transparent)]'")
  })
})
