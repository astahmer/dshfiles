import { describe, expect, it } from 'vitest'
import { resolveTheme } from '@pierre/diffs'
import { PatchLook } from '../src/diff.js'
import { DiffLook } from '../src/theme/diff-look.ts'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

const schemes: readonly Scheme[] = ['light', 'dark']
const STATUS_HUES = [25, 80, 150] as const
const hueDistance = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b))

describe('diff surfaces (round five A4)', () => {
  it.each(schemes)('sit on the ramp: 12 percent add and delete tints in light, a fixed visible band in dark, and a softer separator (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const s = DiffLook.surfaces(p)
    // Dark: the panel step, never the library's near-black; light: the page.
    expect(s.body).toEqual(p.neutral[scheme === 'dark' ? 1 : 0])
    expect(PaletteMath.toHex(s.body)).not.toBe('#0a0a0a')
    if (scheme === 'light') {
      expect(s.addition).toEqual(DiffLook.mixOklab(s.body, p.success.fg, 0.12))
      expect(s.deletion).toEqual(DiffLook.mixOklab(s.body, p.danger.fg, 0.12))
    } else {
      // Council round 7 A6: a 12% tint over the dark panel moved L by about 0.005 and barely separated from the page.
      // The dark bands are their own step, L 0.27 at chroma 0.045 in the success and danger hues.
      expect(s.addition).toEqual({ l: 0.27, c: 0.045, h: p.success.fg.h })
      expect(s.deletion).toEqual({ l: 0.27, c: 0.045, h: p.danger.fg.h })
      for (const band of [s.addition, s.deletion]) {
        expect(band.l - s.body.l).toBeGreaterThanOrEqual(0.05)
        expect(band.c).toBeGreaterThanOrEqual(0.04)
      }
      // A changed word still reads one step above its line.
      expect(s.additionEmphasis.l).toBeGreaterThan(s.addition.l)
      expect(s.deletionEmphasis.c).toBeGreaterThan(s.deletion.c)
    }
    // The collapsed-lines bar is a 3% ink wash: a quiet band, not a grey slab.
    expect(PaletteMath.contrastRatio(s.separator, s.body)).toBeLessThan(1.09)
    expect(PaletteMath.toHex(s.addition)).toBe(scheme === 'light' ? '#e2ece1' : '#152d1a')
    expect(PaletteMath.toHex(s.deletion)).toBe(scheme === 'light' ? '#f6e4e1' : '#3a1d1b')
  })

  it.each(schemes)('are CSS the theme resolves where the diff renders, never a fixed colour (%s)', scheme => {
    const style = DiffLook.style(scheme)
    const body = `var(--dshx-tone-${scheme === 'dark' ? 1 : 0})`
    expect(style['--shiki-background']).toBe(body)
    expect(style['--diffs-bg-context-override']).toBe(body)
    // The library mixes the line override into the body at 12% (light) or 20% (dark); the target lands the line at 12%.
    if (scheme === 'light') {
      expect(style['--diffs-bg-addition-override']).toBe('var(--dshx-tone-success)')
      expect(style['--diffs-bg-deletion-override']).toBe('var(--dshx-tone-danger)')
      expect(style['--diffs-bg-addition-emphasis-override']).toBe(`color-mix(in oklab, var(--dshx-tone-success) 20%, ${body})`)
    } else {
      // Dark lines are the band itself: PatchLook turns the library's dark mix off, so the override is what paints.
      expect(style['--diffs-bg-addition-override']).toBe('oklch(from var(--dshx-tone-success) 0.27 0.045 h)')
      expect(style['--diffs-bg-deletion-override']).toBe('oklch(from var(--dshx-tone-danger) 0.27 0.045 h)')
      expect(style['--diffs-bg-addition-emphasis-override']).toBe('oklch(from var(--dshx-tone-success) 0.32 0.065 h)')
      expect(PatchLook.options(true).unsafeCSS).toMatch(/\[data-line\], \[data-no-newline\], \[data-gutter-buffer\], \[data-column-number\] \{ --mix-dark: 0%; \}/u)
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
    // Comments (faint), punctuation (secondary) and the gutter's +/− numbers read on every line band.
    for (const surface of ['body', 'addition', 'deletion'] as const)
      for (const [name, color] of Object.entries({ comment: ThemeCss.commentColor(p), punctuation: p.neutral[9]!, added: p.success.fg, removed: p.danger.fg }))
        expect(PaletteMath.contrastRatio(color, s[surface]), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5)
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
    expect(Math.abs(comment.l - p.neutral[8]!.l)).toBeLessThanOrEqual(0.02)
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
