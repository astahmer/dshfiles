import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// One overflow glyph (council round 15, A2/D2): the selection bar's narrow ⋯ draws the kit's 16 px stroke-2 glyph,
// not a 14 px Ellipsis sized like the bar's verb icons.
describe('Backlog › selection bar overflow trigger', () => {
  it('draws the kit OverflowGlyph', () => {
    const text = readFileSync(new URL('bulk-selection-bar.tsx', import.meta.url), 'utf8')
    expect(text).toContain("from '@dshfiles/plugin-ui/components/ui/overflow-glyph'")
    expect(text).toMatch(/aria-label="More actions"[^>]*>\s*<OverflowGlyph \/>/u)
    expect(text).not.toContain('EllipsisIcon')
  })
})
