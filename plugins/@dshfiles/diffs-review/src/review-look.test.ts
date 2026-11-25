import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ReviewLook } from './review-look.js'

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('Review look (round five P7, A4)', () => {
  it('leaves the diff surfaces to the kit PatchView, in both schemes (round five A4)', () => {
    // The kit sets the ramp body and 12% line tints as inline custom properties; a review class would only restate them.
    expect(ReviewLook.DARK_DIFF_TINTS).toBe('')
    for (const name of ['panel.tsx', 'changes-facet.tsx', 'combined-review.tsx']) {
      const source = read(name)
      expect(source, name).not.toMatch(/--diffs-bg-(?:addition|deletion|context)/u)
    }
  })

  it('draws review progress as a short 4 px bar beside its count, not a full-width rule', () => {
    expect(ReviewLook.PROGRESS).toMatch(/dshx:w-(24|28|32|36)\b/u)
    expect(ReviewLook.PROGRESS).toContain('dshx:h-1')
    expect(ReviewLook.PROGRESS).toContain('dshx:flex-none')
    const panel = read('panel.tsx')
    expect(panel).toMatch(/reviewed`\} \/>\s*<Progress value=\{progress\} className=\{ReviewLook\.PROGRESS\} \/>/u)
    expect(panel).not.toContain('dshx:min-w-24 dshx:flex-1')
  })
})

describe('Review header and file toolbar (council round 4, D3)', () => {
  const panel = read('panel.tsx')
  it('offers Summarize as an outline header action, not the filled primary', () => {
    expect(panel).not.toContain('primaryAction')
    const actions = panel.slice(panel.indexOf("id: 'refresh'"), panel.indexOf('className="dshx:shrink-0"', panel.indexOf("id: 'refresh'")))
    expect(actions).toMatch(/id: 'summarize'/u)
  })

  it('reads the file count on the left of the file toolbar and the review progress on its right', () => {
    const toolbar = /<div className="([^"]*)" data-review-toolbar>/u.exec(panel)
    expect(toolbar?.[1]).toContain('dshx:justify-between')
    const body = panel.slice(panel.indexOf('data-review-toolbar'), panel.indexOf('result.truncated'))
    expect(body.indexOf('<DiffStat')).toBeLessThan(body.indexOf('reviewed`}'))
    expect(body).toContain('All files reviewed')
  })

  it("draws each file's Reviewed control as a bounded 32 px box on the file row", () => {
    expect(ReviewLook.REVIEWED_TOGGLE).toContain('dshx:h-8')
    expect(ReviewLook.REVIEWED_TOGGLE).toContain('dshx:border')
    expect(ReviewLook.REVIEWED_TOGGLE).toContain('dshx:rounded-md')
    expect(ReviewLook.REVIEWED_TOGGLE).toContain('dshx:pointer-coarse:h-11')
    expect(panel).toMatch(/<label className=\{ReviewLook\.REVIEWED_TOGGLE\}>/u)
  })
})
