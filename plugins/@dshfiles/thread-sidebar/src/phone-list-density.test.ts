import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const client = readFileSync(new URL('client.tsx', import.meta.url), 'utf8')
const header = readFileSync(new URL('thread-group-header.tsx', import.meta.url), 'utf8')
const rows = readFileSync(new URL('virtual-thread-rows.tsx', import.meta.url), 'utf8')
const shell = readFileSync(new URL('destination-shell.tsx', import.meta.url), 'utf8')

describe('phone thread list density (round five B1)', () => {
  it('stands groups 4px apart on touch (the last row gap alone, council round 6 B8), none above the first, 12px with a mouse', () => {
    // 12px on a desktop (council round 13 B3): the last row's 6px gap and 6px; 20px read as loose islands.
    expect(client).toContain("'dshx:not-pointer-coarse:not-first:mt-1.5 dshx:pointer-coarse:not-first:mt-0 dshx:pointer-coarse:first:mt-0'")
    expect(client).not.toContain('not-first:mt-3.5')
    expect(rows).toContain("const ROW_GAP = 'dshx:pb-1.5 dshx:pointer-coarse:pb-1'")
  })

  it('draws a group header 28px tall on touch, its 44px hit area from the kit', () => {
    expect(header).toContain("'dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:px-2.5 dshx:pointer-coarse:h-7 dshx:phone:px-3')")
  })

  it('lays a phone row out as two rows 6px apart, at least 52pt tall, so the first Ready row shows above the tab bar', () => {
    // Council round 18 B1.3: 6px padding, so an 18px title, 6px and a 16px line 2 fill the 52pt exactly.
    expect(client).toContain("'dshx:pointer-coarse:min-h-13 dshx:pointer-coarse:justify-center dshx:pointer-coarse:gap-1.5 dshx:pointer-coarse:py-1.5'")
    expect(client).not.toContain('dshx:pointer-coarse:min-h-14')
  })

  it('keeps the time, the verb and a subagent row time in one trailing column, left of the row menu', () => {
    // The row reserves 44px for its menu button; the verb and a child row end at that same edge.
    expect(client).toContain("'dshx:pointer-coarse:pr-11'")
    expect(client).toContain("verbSeat === 'head' && 'dshx:pointer-coarse:right-11'")
    expect(client).not.toContain('dshx:pointer-coarse:right-10')
  })

  it('seats a 28px verb in the second row, never against the time on the first', () => {
    // Council round 18 B1.3: row 2 stays 16px (one pitch on every row); the 28px verb centres on it from the row's bottom.
    expect(client).not.toContain("verbSeat === 'meta' && 'dshx:pointer-coarse:min-h-7'")
    expect(client).toContain("'dshx:pointer-coarse:h-4 dshx:pointer-coarse:text-xs/4'")
    expect(client).toContain("'dshx:pointer-coarse:bottom-0',")
    // Its label ends at the time column (round nine B5); beside a subagent counter the counter ends the line.
    expect(client).toContain("childCount > 0 ? 'dshx:pointer-coarse:right-11' : 'dshx:pointer-coarse:right-9'")
    expect(client).toContain("className=\"dshx:z-10 dshx:h-6 dshx:px-2 dshx:pointer-coarse:h-7\"")
  })

  it('ends the list under a 24px fade, so the status bar never cuts the last row hard (round five C5)', () => {
    expect(client).toContain("dshx:[mask-image:linear-gradient(to_bottom,#000_calc(100%-24px),transparent)]")
  })

  it('never leaves the selected or the last row under the bottom fade (round nine B6)', () => {
    // The list ends in padding as deep as its fade: 24px, 14px on touch, so the last row scrolled to the end is clear.
    expect(client).toContain("'dshx:min-h-32 dshx:flex-1 dshx:overflow-auto dshx:overscroll-y-contain dshx:px-2 dshx:pb-6 dshx:pointer-coarse:pb-3.5 dshx:phone:px-3 dshx:[mask-image:linear-gradient(to_bottom,#000_calc(100%-24px),transparent)]")
    expect(client).toContain('dshx:pointer-coarse:[mask-image:linear-gradient(to_bottom,#000_calc(100%-14px),transparent)]')
    // A selected row inside the fade zone switches the fade off instead of scrolling the list (`ListFade`).
    expect(client).toContain("'dshx:data-[fade-off]:[mask-image:none]'")
    expect(client).toContain('onScroll={event => ListFade.restore(event.currentTarget)}')
    expect(client).not.toContain('scroll-mb-6')
    expect(client).not.toContain("row?.scrollIntoView({ block: 'nearest' })")
  })

  it('fades the touch list 14px and keeps the phone list on the shell grid (council round 7 B4, round nine B4)', () => {
    // A 14px fade on touch, not 24px: the last line above the tab bar reads instead of fading out.
    expect(client).toContain('dshx:pointer-coarse:[mask-image:linear-gradient(to_bottom,#000_calc(100%-14px),transparent)]')
    // The phone shell grid (round nine B4, B5) spends room the round-7 fold had reclaimed: 12px under the top bar and
    // 44px project and Filter fields, as the council asked.
    expect(shell).toContain("'dshx:fixed dshx:inset-x-0 dshx:z-40 dshx:flex dshx:flex-col dshx:bg-(--dsw-specific-sidebar-fill) dshx:pt-3 dshx:text-foreground'")
    expect(client).toContain('triggerClassName="dshx:min-w-0 dshx:flex-1 dshx:px-2.5 dshx:phone:px-3"')
  })
})
