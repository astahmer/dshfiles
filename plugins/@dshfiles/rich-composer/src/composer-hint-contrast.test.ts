import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PaletteMath, WARM_STONE, type Scheme } from '@dshfiles/plugin-ui/theme/palette'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'native/skeleton/InputBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const hint = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match => (match[1] ?? '').trim() === '.placeholder::after')?.[2] ?? ''

// The composer card's fill per scheme (theme.generated.css: --dsw-specific-input-major is tone 0 in light, tone 2 in dark).
const cardStep = { light: 0, dark: 2 } as const satisfies Record<Scheme, number>

describe('the composer hint after "Ask anything" (council round 13 C4, GLM measured 2.7-3.5:1)', () => {
  it('uses the faint text step at full opacity', () => {
    expect(hint).toMatch(/color: var\(--dsw-alias-label-tertiary\);/)
    expect(hint).not.toMatch(/opacity/)
  })

  it.each(['light', 'dark'] as const)('reads at AA on the composer card and on the page (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const faint = p.neutral[8]!
    expect(PaletteMath.contrastRatio(faint, p.neutral[cardStep[scheme]]!)).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(faint, p.neutral[0]!)).toBeGreaterThanOrEqual(4.5)
  })
})
