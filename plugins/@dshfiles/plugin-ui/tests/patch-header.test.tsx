import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChangeBadge, PatchLook, parsePatchFiles } from '../src/diff.js'
import { DiffLook } from '../src/theme/diff-look.js'
import { PaletteMath, WARM_STONE, type Oklch } from '../src/theme/palette.ts'

/** `over` at `alpha` on `under`, mixed in oklab as Tailwind's `/12` opacity (`color-mix(in oklab, …)`) paints it. */
const tintOver = (under: Oklch, over: Oklch, alpha: number): Oklch => {
  const lab = ({ l, c, h }: Oklch): readonly [number, number, number] => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
  const [u, o] = [lab(under), lab(over)]
  const [l, a, b] = u.map((value, i) => value * (1 - alpha) + (o[i] ?? 0) * alpha) as [number, number, number]
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return { l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h }
}

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

describe('PatchView change badge (council round 17 A2)', () => {
  const file = parsePatchFiles(patch).flatMap(parsed => parsed.files)[0]

  it("hides the library's ringed-dot glyph, which read as a radio button", () => {
    for (const dark of [false, true]) {
      const css = PatchLook.options(dark).unsafeCSS ?? ''
      expect(css).toMatch(/\[data-change-icon\]\s*\{\s*display:\s*none;?\s*\}/u)
      // The line selection and the rename arrow keep the library's modified tone at the warning step.
      expect(DiffLook.style(dark ? 'dark' : 'light')['--diffs-modified-color-override']).toBe('var(--dshx-tone-warning)')
    }
  })

  it('leads the header with a letter badge, after what the caller adds', () => {
    expect(file?.type).toBe('change')
    if (file === undefined) return
    const markup = renderToStaticMarkup(<>{PatchLook.headerPrefix(file, <span data-caller="">Pick</span>)}</>)
    expect(markup).toMatch(/^<span class="dshx:flex dshx:items-center dshx:gap-2" data-patch-header-prefix=""><span data-caller="">/u)
    expect(markup).toMatch(/<span data-change-badge="change" class="[^"]*dshx:size-4[^"]*dshx:bg-warning\/12 dshx:text-warning"><span aria-hidden="true">M<\/span><span class="dshx:sr-only">Modified<\/span><\/span>/u)
  })

  it('names each change type with its letter, its words and its tone at the tint rung (council round 18 A2)', () => {
    const cases = [
      ['change', 'M', 'Modified', 'dshx:bg-warning/12 dshx:text-warning'],
      ['new', 'A', 'Added', 'dshx:bg-success/12 dshx:text-success'],
      ['deleted', 'D', 'Deleted', 'dshx:bg-destructive/12 dshx:text-destructive'],
      ['rename-pure', 'R', 'Renamed', 'dshx:bg-muted-foreground/12 dshx:text-muted-foreground'],
      ['rename-changed', 'R', 'Renamed and modified', 'dshx:bg-muted-foreground/12 dshx:text-muted-foreground'],
    ] as const
    for (const [type, letter, label, tone] of cases) {
      const markup = renderToStaticMarkup(<ChangeBadge type={type} />)
      expect(markup, type).toContain(`<span aria-hidden="true">${letter}</span><span class="dshx:sr-only">${label}</span>`)
      expect(markup, type).toContain(tone)
      // A tag, not a ringed box: no edge.
      expect(markup, type).not.toContain('dshx:border')
    }
  })

  it.each(['light', 'dark'] as const)('holds AA for every badge letter on its own tint over the file header (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const header = DiffLook.surfaces(p).body
    for (const [name, tone] of [
      ['warning', p.warning.fg],
      ['success', p.success.fg],
      ['danger', p.danger.fg],
      ['secondary', p.neutral[9]!],
    ] as const)
      expect(PaletteMath.contrastRatio(tone, tintOver(header, tone, 0.12)), name).toBeGreaterThanOrEqual(4.5)
  })
})
