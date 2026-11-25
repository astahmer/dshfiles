import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ReviewLook } from './review-look.js'

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('Review look (round five P7)', () => {
  it('clamps dark diff line tints to the success and danger -bg tokens (12 %)', () => {
    expect(ReviewLook.DARK_DIFF_TINTS).toContain('dshx:dark:[--diffs-bg-addition-override:var(--dshx-tone-success-bg)]')
    expect(ReviewLook.DARK_DIFF_TINTS).toContain('dshx:dark:[--diffs-bg-deletion-override:var(--dshx-tone-danger-bg)]')
    // Light keeps the diff library's own scheme.
    expect(ReviewLook.DARK_DIFF_TINTS.split(' ').every(utility => utility.startsWith('dshx:dark:'))).toBe(true)
  })

  it('gives every review diff the clamped tints', () => {
    for (const name of ['panel.tsx', 'changes-facet.tsx', 'combined-review.tsx']) {
      const source = read(name)
      const views = [...source.matchAll(/<PatchView[\s\S]*?\/>|<PatchView[\s\S]*?>/gu)]
      expect(views.length, name).toBeGreaterThan(0)
      for (const view of views) expect(view[0], name).toContain('ReviewLook.DARK_DIFF_TINTS')
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
