import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PatchLook, parsePatchFiles } from '../src/diff.js'

const patch = `diff --git a/src/totals.ts b/src/totals.ts
--- a/src/totals.ts
+++ b/src/totals.ts
@@ -1,4 +1,4 @@
 let total = 0
-total += net + net * rate
+total += net + Math.round(net * rate)
-return Math.round(total)
+return total
 }
`

describe('PatchView file header (council round 3, D5)', () => {
  const file = parsePatchFiles(patch).flatMap(parsed => parsed.files)[0]

  it("hides the library's own counts, which read −N before +N in a mono face", () => {
    for (const dark of [false, true]) {
      const css = PatchLook.options(dark).unsafeCSS ?? ''
      expect(css).toMatch(/\[data-deletions-count\],\s*\[data-additions-count\]\s*\{\s*display:\s*none;?\s*\}/u)
    }
  })

  it('heads the header metadata with the kit DiffStat from the file hunks, before what the caller adds', () => {
    expect(file).toBeDefined()
    if (file === undefined) return
    const markup = renderToStaticMarkup(<>{PatchLook.headerMetadata(file, <span data-caller="">Reviewed</span>)}</>)
    // One row, the count first: the shadow slot stacks bare children.
    expect(markup).toMatch(/^<span class="dshx:flex dshx:items-center dshx:gap-3" data-patch-header-metadata=""><span data-slot="diff-stat"/u)
    expect(markup).toMatch(/data-diff-side="added"[^>]*>\+2<\/span>/u)
    expect(markup).toMatch(/data-diff-side="removed"[^>]*>−2<\/span>/u)
    expect(markup.indexOf('data-slot="diff-stat"')).toBeLessThan(markup.indexOf('data-caller'))
  })
})

describe('PatchView file name (council round 4, D3)', () => {
  it('sets the file name 13/18 at 600 inside the shadow root, above the 12 px code', () => {
    for (const dark of [false, true]) {
      const css = PatchLook.options(dark).unsafeCSS ?? ''
      expect(css).toMatch(/\[data-title\]\s*\{\s*font-size:\s*13px;\s*line-height:\s*18px;\s*font-weight:\s*600;?\s*\}/u)
    }
  })
})

describe('PatchView collapsed-lines bar (council round 6, D2)', () => {
  it('runs the bar edge to edge like the diff rows: no inset on either side, square ends', () => {
    for (const dark of [false, true]) {
      const css = PatchLook.options(dark).unsafeCSS ?? ''
      expect(css).toMatch(/\[data-separator=line-info\] \[data-separator-wrapper\]\s*\{[^}]*padding-inline:\s*0;/u)
      expect(css).toMatch(/\[data-separator=line-info\] \[data-separator-content\]\s*\{\s*border-radius:\s*0;?\s*\}/u)
    }
  })
})
