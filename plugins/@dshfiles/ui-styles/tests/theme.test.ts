import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PaletteMath, WARM_STONE } from '@dshfiles/plugin-ui/theme/palette'
import { ThemeCss, DARK_SELECTOR, LIGHT_SELECTOR } from '@dshfiles/plugin-ui/theme/css'
import { describe, expect, it } from 'vitest'

const generated = readFileSync(join(process.cwd(), 'src/theme.generated.css'), 'utf8')
const client = readFileSync(join(process.cwd(), 'src/client.css'), 'utf8')

describe('theme block', () => {
  it('is the current generator output (run plugin-ui/scripts/emit-theme-css.ts after changing the palette)', () => {
    expect(generated).toBe(ThemeCss.themeCss())
  })

  it('is imported unlayered by the injected sheet', () => {
    expect(client).toContain("@import './theme.generated.css';")
    expect(client).not.toMatch(/theme\.generated\.css'\s*layer\(/u)
  })

  it('out-ranks the Host body and body[data-ds-dark-theme] blocks by specificity, not order', () => {
    expect(generated).toContain(`${LIGHT_SELECTOR} {`)
    expect(generated).toContain(`${DARK_SELECTOR} {`)
    expect(generated).toContain(':root:root {')
  })

  it('never touches Host font sizes (Settings › Font size)', () => {
    expect(generated).not.toMatch(/--dsh-[a-z-]*font-size|--dsh-content-font-delta|--dsh-code-font-delta|font-size:/u)
  })

  it('draws native menus opaque, on the fill kit popovers use, in both schemes', () => {
    // The Host material (a 70% fill over a 40px blur) reads the transcript through the composer's @, / and + lists.
    const [, light = '', dark = ''] = generated.split(/\n(?:html body|body\[data-ds-dark-theme\]\[data-ds-dark-theme\]) \{\n/u)
    for (const block of [light, dark]) {
      const popover = /--dsw-alias-bg-layer-2: (var\(--dshx-tone-\d+\));/u.exec(block)?.[1]
      expect(popover).toBeDefined()
      expect(block).toContain(`--dsw-menu-surface-fill: ${popover};`)
      expect(block).toContain('--dsw-menu-backdrop-filter: none;')
    }
  })

  it('keeps Shiki token colours readable on the code block', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const code = PaletteMath.palette({ ...WARM_STONE, scheme }).neutral[1]!
      for (const hue of Object.values(ThemeCss.SYNTAX_HUES)) expect(PaletteMath.contrastRatio(ThemeCss.syntaxColor(hue, scheme), code)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
