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

  it('runs the Review page full width: it holds a diff (council round 3 A5)', () => {
    expect(read('panel.tsx')).toMatch(/<Page\s+width="full"\s+heading="Review"\s+description="Changed files/u)
  })
})
