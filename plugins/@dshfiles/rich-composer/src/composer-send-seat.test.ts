import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PaletteMath, WARM_STONE, type Scheme } from '@dshfiles/plugin-ui/theme/palette'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'native/skeleton/InputBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of `selector` at the top level ('') or inside every block opening with `media`. */
const rules = (media: string, selector: string): string => {
  const scopes: string[] = []
  if (media === '') scopes.push(css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''))
  for (let from = media === '' ? -1 : css.indexOf(media); from >= 0; from = css.indexOf(media, from + 1)) {
    const open = css.indexOf('{', from)
    let depth = 0
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}') depth -= 1
      if (depth === 0) {
        scopes.push(css.slice(open + 1, index))
        break
      }
    }
  }
  return scopes.flatMap(scope => [...scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => (match[1] ?? '').trim() === selector).map(match => match[2] ?? '')).join('\n')
}

describe('the composer send seat (council round 13 C3)', () => {
  it('is a 28px circle on a fine pointer and 32px on touch (the bar\'s 44pt hit area stays)', () => {
    const base = rules('', '.primary')
    expect(base).toMatch(/width: 28px;/)
    expect(base).toMatch(/height: 28px;/)
    expect(base).toMatch(/border-radius: 999px;/)
    const touch = rules('@media (pointer: coarse)', '.primary')
    expect(touch).toMatch(/width: 32px;/)
    expect(touch).toMatch(/height: 32px;/)
    expect(rules('@media (pointer: coarse)', '.row :where(button)::after')).toMatch(/44px/)
  })

  it('is ink with the inverse glyph when ready', () => {
    const base = rules('', '.primary')
    expect(base).toMatch(/background: var\(--dshx-tone-text, var\(--dsw-alias-label-primary\)\);/)
    expect(base).toMatch(/color: var\(--dshx-tone-bg, var\(--dsw-alias-bg-base\)\);/)
  })

  it('keeps its disc when disabled: the + control\'s raised fill with a faint glyph', () => {
    const disabled = rules('', '.primary:disabled')
    expect(disabled).toMatch(/background: var\(--dsw-specific-selector, var\(--dshx-tone-raised\)\);/)
    expect(disabled).toMatch(/color: var\(--dsw-alias-label-tertiary\);/)
    expect(disabled).not.toMatch(/transparent/)
  })

  it('rims its resting disc with a 1px border-l2 hairline drawn inside, so a disabled send stays findable (council round 14 C5)', () => {
    const disabled = rules('', '.primary:disabled')
    expect(disabled).toMatch(/box-shadow: inset 0 0 0 1px var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
    // Inside the disc, never a border: the circle keeps its 28px box (no layout shift).
    expect(disabled).not.toMatch(/border:/)
    // The ready circle (ink) draws no hairline.
    expect(rules('', '.primary')).not.toMatch(/box-shadow/)
  })

  it.each(['light', 'dark'] as const)('reads the ready glyph and the faint glyph at 3:1 or more (%s)', (scheme: Scheme) => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(PaletteMath.contrastRatio(p.neutral[0]!, p.neutral[10]!)).toBeGreaterThanOrEqual(4.5)
    // Faint glyph on the raised disc (tone 2 in light; the dark disc sits a step or two above the tone-2 card).
    for (const step of scheme === 'light' ? [2] : [2, 3, 4]) expect(PaletteMath.contrastRatio(p.neutral[8]!, p.neutral[step]!)).toBeGreaterThanOrEqual(3)
  })
})
