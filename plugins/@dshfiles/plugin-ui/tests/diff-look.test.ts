import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@pierre/diffs'
import { PatchLook } from '../src/diff.js'
import { DiffLook } from '../src/theme/diff-look.ts'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

const schemes: readonly Scheme[] = ['light', 'dark']
/** The dark bands (council round 10 A4: L 0.25, chroma 0.04) as sRGB. */
/** The light bands (council round 11 A3: 16% of the success and danger tones over the page). */
const LIGHT_ADDITION_HEX = '#d9e7d8'
const LIGHT_DELETION_HEX = '#f4dcd8'
const DARK_ADDITION_HEX = '#132717'
const DARK_DELETION_HEX = '#321a18'
const STATUS_HUES = [25, 80, 150] as const
const hueDistance = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe('diff surfaces (round five A4)', () => {
  it.each(schemes)('sit on the ramp: 16 percent add and delete tints and 34 percent changed words in light, a fixed visible band in dark, and a softer separator (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const s = DiffLook.surfaces(p)
    // Dark: the panel step, never the library's near-black; light: the page.
    expect(s.body).toEqual(p.neutral[scheme === 'dark' ? 1 : 0])
    expect(PaletteMath.toHex(s.body)).not.toBe('#0a0a0a')
    if (scheme === 'light') {
      // Council round 11 A3: at 12% / 20% a changed word lifted only 1.08:1 off its line; 16% / 34% lift it clearly.
      expect(s.addition).toEqual(DiffLook.mixOklab(s.body, p.success.fg, 0.16))
      expect(s.deletion).toEqual(DiffLook.mixOklab(s.body, p.danger.fg, 0.16))
      expect(s.additionEmphasis).toEqual(DiffLook.mixOklab(s.body, p.success.fg, 0.34))
      expect(s.deletionEmphasis).toEqual(DiffLook.mixOklab(s.body, p.danger.fg, 0.34))
      for (const [word, line] of [[s.additionEmphasis, s.addition], [s.deletionEmphasis, s.deletion]] as const)
        expect(PaletteMath.contrastRatio(word, line)).toBeGreaterThanOrEqual(1.15)
    } else {
      // Council round 7 A6: a 12% tint over the dark panel moved L by about 0.005 and barely separated from the page.
      // The dark bands are their own step in the success and danger hues; council round 10 A4 calmed them to L 0.25 at
      // chroma 0.04 and lifted a changed word clearly above its line, to L 0.34 at 0.075.
      expect(s.addition).toEqual({ l: 0.25, c: 0.04, h: p.success.fg.h })
      expect(s.deletion).toEqual({ l: 0.25, c: 0.04, h: p.danger.fg.h })
      expect(s.additionEmphasis).toEqual({ l: 0.34, c: 0.075, h: p.success.fg.h })
      expect(s.deletionEmphasis).toEqual({ l: 0.34, c: 0.075, h: p.danger.fg.h })
      for (const band of [s.addition, s.deletion]) {
        expect(band.l - s.body.l).toBeGreaterThanOrEqual(0.04)
        expect(band.c).toBeGreaterThanOrEqual(0.04)
      }
      // A changed word reads clearly above its line: at least 0.08 of lightness and more chroma.
      for (const [word, line] of [[s.additionEmphasis, s.addition], [s.deletionEmphasis, s.deletion]] as const) {
        expect(word.l - line.l).toBeGreaterThanOrEqual(0.08)
        expect(word.c).toBeGreaterThan(line.c)
      }
    }
    // The collapsed-lines bar is a 3% ink wash: a quiet band, not a grey slab.
    expect(PaletteMath.contrastRatio(s.separator, s.body)).toBeLessThan(1.09)
    expect(PaletteMath.toHex(s.addition)).toBe(scheme === 'light' ? LIGHT_ADDITION_HEX : DARK_ADDITION_HEX)
    expect(PaletteMath.toHex(s.deletion)).toBe(scheme === 'light' ? LIGHT_DELETION_HEX : DARK_DELETION_HEX)
  })

  it.each(schemes)('are CSS the theme resolves where the diff renders, never a fixed colour (%s)', scheme => {
    const style = DiffLook.style(scheme)
    const body = `var(--dshx-tone-${scheme === 'dark' ? 1 : 0})`
    expect(style['--shiki-background']).toBe(body)
    expect(style['--diffs-bg-context-override']).toBe(body)
    // PatchLook turns the library's own line mix off in both schemes, so each override is exactly what paints.
    if (scheme === 'light') {
      expect(style['--diffs-bg-addition-override']).toBe(`color-mix(in oklab, var(--dshx-tone-success) 16%, ${body})`)
      expect(style['--diffs-bg-deletion-override']).toBe(`color-mix(in oklab, var(--dshx-tone-danger) 16%, ${body})`)
      expect(style['--diffs-bg-addition-emphasis-override']).toBe(`color-mix(in oklab, var(--dshx-tone-success) 34%, ${body})`)
      expect(style['--diffs-bg-deletion-emphasis-override']).toBe(`color-mix(in oklab, var(--dshx-tone-danger) 34%, ${body})`)
      expect(PatchLook.options(false).unsafeCSS).toMatch(/\[data-line\], \[data-no-newline\], \[data-gutter-buffer\], \[data-column-number\] \{ --mix-dark: 0%; --mix-light: 0%; \}/u)
    } else {
      // Dark lines are the band itself: PatchLook turns the library's dark mix off, so the override is what paints.
      expect(style['--diffs-bg-addition-override']).toBe('oklch(from var(--dshx-tone-success) 0.25 0.04 h)')
      expect(style['--diffs-bg-deletion-override']).toBe('oklch(from var(--dshx-tone-danger) 0.25 0.04 h)')
      expect(style['--diffs-bg-addition-emphasis-override']).toBe('oklch(from var(--dshx-tone-success) 0.34 0.075 h)')
      expect(style['--diffs-bg-deletion-emphasis-override']).toBe('oklch(from var(--dshx-tone-danger) 0.34 0.075 h)')
      expect(PatchLook.options(true).unsafeCSS).toMatch(/\[data-line\], \[data-no-newline\], \[data-gutter-buffer\], \[data-column-number\] \{ --mix-dark: 0%; --mix-light: 0%; \}/u)
    }
    expect(style['--diffs-bg-addition-number-override']).toBe(style['--diffs-bg-addition-override'])
    expect(style['--diffs-bg-deletion-number-override']).toBe(style['--diffs-bg-deletion-override'])
    for (const value of Object.values(style)) expect(value).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
  })

  it.each(schemes)('keep every syntax colour at AA on context, added, removed and emphasised lines and the code block (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const s = DiffLook.surfaces(p)
    const under = { ...s, page: p.neutral[0]!, codeBlock: p.neutral[1]!, raised: p.neutral[2]! }
    for (const [role, color] of Object.entries(ThemeCss.syntaxColors(p)))
      for (const [surface, back] of Object.entries(under))
        expect(PaletteMath.contrastRatio(color, back), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    // Comments (faint), punctuation (secondary) and the gutter's +/− numbers read on every line band. The light diff
    // draws its own (council round 11 A3): punctuation and comments capped at L 0.43, the marks pulled toward the ink.
    const light = scheme === 'light' ? DiffLook.text(p) : undefined
    const text = {
      comment: light?.comment ?? ThemeCss.commentColor(p),
      punctuation: light?.punctuation ?? p.neutral[9]!,
      added: light?.addition ?? p.success.fg,
      removed: light?.deletion ?? p.danger.fg,
    }
    for (const surface of ['body', 'addition', 'deletion'] as const)
      for (const [name, color] of Object.entries(text)) expect(PaletteMath.contrastRatio(color, s[surface]), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    // Plain code (the ink) and punctuation inside a changed word (council round 10 A4 for dark, round 11 A3 for light);
    // comments too in light. A dark comment sits at 3.7:1 on its changed word (the round-10 dark bands, unchanged here).
    for (const surface of ['additionEmphasis', 'deletionEmphasis'] as const)
      for (const [name, color] of Object.entries(light === undefined ? { punctuation: text.punctuation, ink: p.neutral[10]! } : { punctuation: text.punctuation, ink: p.neutral[10]!, comment: text.comment }))
        expect(PaletteMath.contrastRatio(color, s[surface]), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5)
    if (light !== undefined) {
      // The same colours as CSS over the theme tones, so a preset repaints them.
      const style = DiffLook.style('light')
      expect(style['--shiki-token-punctuation']).toBe('oklch(from var(--dshx-tone-9) min(l, 0.43) c h)')
      expect(style['--shiki-token-comment']).toBe('oklch(from var(--dshx-tone-8) min(l, 0.43) c h)')
      expect(style['--diffs-addition-color-override']).toBe('color-mix(in oklab, var(--dshx-tone-success) 75%, var(--dshx-tone-10))')
      expect(style['--diffs-deletion-color-override']).toBe('color-mix(in oklab, var(--dshx-tone-danger) 75%, var(--dshx-tone-10))')
    } else {
      expect(DiffLook.style('dark')).not.toHaveProperty('--shiki-token-punctuation')
      expect(DiffLook.style('dark')['--diffs-addition-color-override']).toBe('var(--dshx-tone-success)')
    }
  })

  it('keeps syntax hues away from the status hues, so a keyword never reads as a deletion', () => {
    for (const hue of Object.values(ThemeCss.SYNTAX_HUES))
      for (const status of STATUS_HUES) expect(hueDistance(hue, status), `${hue} vs ${status}`).toBeGreaterThanOrEqual(25)
  })
})

describe('one syntax pair for the transcript and the diff (round five A4)', () => {
  it.each(schemes)('emits the transcript tokens from the same fitted colours (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const block = ThemeCss.blockDeclarations(WARM_STONE, scheme).join('\n')
    for (const [role, color] of Object.entries(ThemeCss.syntaxColors(p))) expect(block).toContain(`--shiki-token-${role}: ${PaletteMath.toCss(color)};`)
    // Comments are the faint step, darkened only as far as the diff bands need.
    const comment = ThemeCss.commentColor(p)
    expect(block).toContain(`--shiki-token-comment: ${PaletteMath.toCss(comment)};`)
    expect(comment.h).toBe(p.neutral[8]!.h)
    // Council round 11 A3's 16% light lines move it 0.02 (it sat 0.015 off at 12%).
    expect(Math.abs(comment.l - p.neutral[8]!.l)).toBeLessThanOrEqual(0.0201)
  })

  it('renders the diff with the css-variables theme the transcript uses, with +/− gutter marks', async () => {
    for (const dark of [false, true]) {
      const options = PatchLook.options(dark)
      expect(options.theme).toEqual({ dark: PatchLook.THEME, light: PatchLook.THEME })
      expect(options.diffIndicators).toBe('classic')
    }
    const theme = await resolveTheme(PatchLook.THEME)
    expect(theme.fg).toBe('var(--shiki-foreground)')
    // Shiki keeps each variable as a colour replacement of a placeholder token colour.
    expect(JSON.stringify(theme.colorReplacements)).toContain('var(--shiki-token-keyword)')
    expect(PatchLook.style(true)).toMatchObject(DiffLook.style('dark'))
    expect(PatchLook.style(false)).toMatchObject(DiffLook.style('light'))
  })
})
