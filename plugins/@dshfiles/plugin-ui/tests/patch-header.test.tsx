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
