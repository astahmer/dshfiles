import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('Review change counts (council round 3, D5)', () => {
  it('draws every summary and per-file count with the kit DiffStat: +N before −N, sans tabular', () => {
    for (const name of ['panel.tsx', 'combined-review.tsx', 'changes-facet.tsx']) {
      const source = read(name)
      expect(source, name).toMatch(/<DiffStat /u)
      // No hand-made count is left: a "−{n}" span or label, or a Stat toned as an addition.
      expect(source, name).not.toMatch(/>−\{[^}]+\}<|label=\{`−\$\{|tone="add"/u)
    }
  })

  it('sets the Review page and its diff cards on the wide data frame (council round 5 A2/D3)', () => {
    expect(read('panel.tsx')).toMatch(
      /<Page\s+width="wide"\s+(?:\/\/[^\n]*\n\s*)*mark=\{<GitMerge \/>\}\s+markTone="land"\s+heading="Review"\s+(?:\/\/[^\n]*\n\s*)*description="Changed files/u,
    )
    // The cards sit outside Page, so they take the same frame: the same start inset and the same 1200 px cap.
    expect(read('panel.tsx')).toMatch(/<div className=\{cn\(PAGE_FRAME_CLASS\.wide, 'dshx:px-6 dshx:@max-pane-narrow:px-3'\)\} data-review-cards>/u)
  })
})
