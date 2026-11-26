import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

// One overflow glyph (council round 15, A2/D2): every ⋯ trigger draws the kit's 16 px stroke-2 glyph, so an `icon-xs`
// row trigger no longer shrinks it to 12 px beside the 16 px page and header triggers.
describe('AI accounts › overflow triggers', () => {
  it.each(['account-group.tsx', 'model-curation.tsx', 'account-detail.tsx', 'accounts-toolbar.tsx'])('%s draws the kit OverflowGlyph', name => {
    const text = source(name)
    expect(text).toContain("from '@dshfiles/plugin-ui/components/ui/overflow-glyph'")
    expect(text).toContain('<OverflowGlyph />')
    expect(text).not.toMatch(/MoreHorizontalIcon|EllipsisIcon/u)
  })
})
