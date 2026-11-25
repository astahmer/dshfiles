import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/ChangedFiles.module.css', import.meta.url), 'utf8')

// Round five C2 (council round 4): a turn showed "Edited totals.ts +2 −2" as a card and again as the summary line's
// `totals.ts +2 −2` chip. Where the chips name every edited file, the card steps aside; the chips open the same review.
describe('the changed-files card beside the turn summary chips', () => {
  it("hides itself in a turn tail whose chips name every file", () => {
    expect(css).toMatch(/:global\(\[data-turn-tail\]\):has\(:global\(\[data-dshfiles-turn-file-chips='all'\]\)\) \.card \{\s*display: none;\s*\}/)
  })
})
