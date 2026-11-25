// @vitest-environment jsdom
import { parsePatchFiles } from '@pierre/diffs'
import { preloadFileDiff, preloadMultiFileDiff } from '@pierre/diffs/ssr'
import { describe, expect, it } from 'vitest'
import { PatchLook } from '../src/diff.js'

const lines = (n: number): string => Array.from({ length: n }, (_, index) => `const v${index} = ${index}`).join('\n') + '\n'
const options = { hunkSeparators: 'line-info', theme: PatchLook.THEME } as const

/** The library's own markup for a diff, in a detached document, as the shadow root holds it. */
const markup = (html: string): HTMLElement => {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}
const labels = (root: ParentNode): readonly string[] => [...root.querySelectorAll('[data-unmodified-lines]')].map(span => span.textContent ?? '')

describe('PatchView collapsed-lines bar (council round 7 A3)', () => {
  it('reads "Show N unchanged lines" where the bar expands, the chevron in the line-number gutter', async () => {
    const old = lines(40)
    const { prerenderedHTML } = await preloadMultiFileDiff({
      oldFile: { name: 'a.ts', contents: old },
      newFile: { name: 'a.ts', contents: old.replace('const v20 = 20', 'const v20 = 21') },
      options,
    })
    const root = markup(prerenderedHTML)
    expect(root.querySelectorAll('[data-separator=line-info][data-expand-index] [data-expand-button]').length).toBeGreaterThan(0)
    expect(labels(root)).toContain('16 unmodified lines')
    PatchLook.relabelSeparators(root)
    expect(labels(root)).toEqual(expect.arrayContaining(['Show 16 unchanged lines', 'Show 15 unchanged lines']))
    expect(labels(root).join(' ')).not.toContain('unmodified')
    // Idempotent: a second pass after an update changes nothing.
    PatchLook.relabelSeparators(root)
    expect(labels(root)).toContain('Show 16 unchanged lines')
  })

  it('reads "N unchanged lines", with no chevron, where it cannot expand (a patch without the file)', async () => {
    const file = parsePatchFiles('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -10,3 +10,3 @@\n a\n-b\n+c\n d\n').flatMap(parsed => parsed.files)[0]!
    const root = markup((await preloadFileDiff({ fileDiff: file, options })).prerenderedHTML)
    expect(root.querySelectorAll('[data-expand-button]')).toHaveLength(0)
    PatchLook.relabelSeparators(root)
    expect(labels(root)).toContain('9 unchanged lines')
    // One line is singular.
    const one = markup('<div data-separator="line-info"><div data-separator-wrapper=""><div data-separator-content=""><span data-unmodified-lines="">1 unmodified line</span></div></div></div>')
    PatchLook.relabelSeparators(one)
    expect(labels(one)).toEqual(['1 unchanged line'])
  })

  it('relabels each render through onPostRender, inside the shadow root', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<div data-separator="line-info" data-expand-index="0"><div data-separator-wrapper=""><div data-separator-content=""><span data-unmodified-lines="">3 unmodified lines</span></div></div></div>'
    PatchLook.options(false).onPostRender?.(host, undefined as never, 'update')
    expect(labels(shadow)).toEqual(['Show 3 unchanged lines'])
  })

  it('reaches both card edges and puts the label at the code inset, the chevron at 14px in the gutter', () => {
    const css = PatchLook.options(true).unsafeCSS ?? ''
    // No inset on either side (the library pads the right by its 8px gap).
    expect(css).toMatch(/\[data-separator=line-info\] \[data-separator-wrapper\]\s*\{[^}]*padding-inline:\s*0;/u)
    // The gutter is the line-number column: its digits, 2ch before and 1ch after them, and the 2px rule, in the code face.
    expect(css).toContain('--dshx-diff-gutter: calc(var(--diffs-min-number-column-width, var(--diffs-min-number-column-width-default, 3ch)) + 3ch + 2px);')
    expect(css).toMatch(/\[data-separator=line-info\] \[data-separator-wrapper\]\s*\{[^}]*font-family:\s*var\(--diffs-font-family/u)
    expect(css).toMatch(/\[data-separator=line-info\]\[data-expand-index\] \[data-separator-wrapper\][^{]*\{[^}]*grid-template-columns:\s*var\(--dshx-diff-gutter\) auto;/u)
    // The label starts where the code does (classic indicators pad a line 2ch): after the chevron's gutter, or the
    // gutter itself when there is no chevron.
    expect(css).toMatch(/\[data-separator=line-info\]\[data-expand-index\] \[data-separator-content\]\s*\{[^}]*padding-inline:\s*2ch 1ch;/u)
    expect(css).toMatch(/\[data-separator=line-info\]:not\(\[data-expand-index\]\) \[data-separator-content\]\s*\{[^}]*padding-inline:\s*calc\(var\(--dshx-diff-gutter\) \+ 2ch\) 1ch;/u)
    expect(css).toMatch(/\[data-unmodified-lines\]\s*\{[^}]*font-family:\s*var\(--diffs-header-font-family/u)
    expect(css).toMatch(/\[data-expand-button\] \[data-icon\]\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/u)
    expect(css).toMatch(/\[data-separator=line-info\] \[data-expand-button\]\s*\{[^}]*border-radius:\s*0;/u)
  })
})
