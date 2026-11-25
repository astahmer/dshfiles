import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

// Vitest runs each package from its root.
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const schemes: readonly Scheme[] = ['light', 'dark']

describe('prompt fill (council round 6 A5)', () => {
  it.each(schemes)('is a faint cool tint at hue 230 (%s)', scheme => {
    const { promptFill } = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(promptFill).toEqual(scheme === 'light' ? { l: 0.965, c: 0.012, h: 230 } : { l: 0.255, c: 0.018, h: 230 })
  })

  it.each(schemes)('keeps 40° or more from the default indigo and is never the Needs-you wash (%s)', scheme => {
    for (const accentHue of [270, 300, 150]) {
      const p = PaletteMath.palette({ ...WARM_STONE, accentHue, scheme })
      const distance = Math.abs(((p.promptFill.h - accentHue + 540) % 360) - 180)
      if (accentHue === 270) expect(distance).toBeGreaterThanOrEqual(40)
      // Never the Needs-you wash: a prompt is not attention.
      expect(p.promptFill).not.toEqual(p.needsYouWash)
    }
  })

  it.each(schemes)('holds ink, secondary and faint text and links at AA on it (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const step of [8, 9, 10]) expect(PaletteMath.contrastRatio(p.neutral[step]!, p.promptFill), `step ${step}`).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.accent.fg, p.promptFill), 'link').toBeGreaterThanOrEqual(4.5)
  })

  it('is emitted in both theme blocks and exposed as the prompt-fill colour for chat', () => {
    expect(ThemeCss.blockDeclarations(WARM_STONE, 'light').join('\n')).toContain('--dshx-prompt-fill: oklch(0.965 0.012 230);')
    expect(ThemeCss.blockDeclarations(WARM_STONE, 'dark').join('\n')).toContain('--dshx-prompt-fill: oklch(0.255 0.018 230);')
    expect(roles).toContain('--color-prompt-fill: var(--dshx-prompt-fill, var(--dsw-specific-bubble));')
  })
})
