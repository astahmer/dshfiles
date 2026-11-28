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

/** The sheet without every block that opens with `prelude` (nested rules included). */
const without = (prelude: string): string => {
  let sheet = css
  for (let from = sheet.indexOf(prelude); from >= 0; from = sheet.indexOf(prelude)) {
    let depth = 0
    for (let index = sheet.indexOf('{', from); index < sheet.length; index += 1) {
      if (sheet[index] === '{') depth += 1
      if (sheet[index] === '}') depth -= 1
      if (depth === 0) {
        sheet = sheet.slice(0, from) + sheet.slice(index + 1)
        break
      }
    }
  }
  return sheet
}

/** Custom properties a pointer sees, by name (the last declaration wins, as in the cascade's order). */
const customProperties = (pointer: 'fine' | 'coarse'): ReadonlyMap<string, string> =>
  new Map(
    [...(pointer === 'fine' ? without('@media (pointer: coarse)') : css).matchAll(/(--[\w-]+):\s*([^;{}]+);/g)].map(match => [
      match[1] ?? '',
      (match[2] ?? '').trim(),
    ]),
  )

/** A px length: a number, `Npx`, `var(--x, fallback)` or a `calc()` of them with + - * / and parentheses. */
const lengthOf = (expression: string, properties: ReadonlyMap<string, string>): number => {
  let source = expression
  for (let guard = 0; /var\(/.test(source); guard += 1) {
    if (guard > 20) throw new Error(`unresolved: ${expression}`)
    source = source.replace(/var\((--[\w-]+)(?:,\s*([^()]+))?\)/g, (_, name: string, fallback: string | undefined) => {
      const value = properties.get(name) ?? fallback
      if (value === undefined) throw new Error(`no value for ${name} in ${expression}`)
      return `(${value})`
    })
  }
  const tokens = source.replace(/calc\(/g, '(').replace(/(\d)px/g, '$1').match(/\d+(?:\.\d+)?|[-+*/()]/g) ?? []
  let at = 0
  const primary = (): number => {
    const token = tokens[at++]
    if (token === '(') {
      const value = sum()
      at += 1
      return value
    }
    if (token === '-') return -primary()
    return Number(token)
  }
  const product = (): number => {
    let value = primary()
    while (tokens[at] === '*' || tokens[at] === '/') value = tokens[at++] === '*' ? value * primary() : value / primary()
    return value
  }
  const sum = (): number => {
    let value = product()
    while (tokens[at] === '+' || tokens[at] === '-') value = tokens[at++] === '+' ? value + product() : value - product()
    return value
  }
  return sum()
}

const declaration = (body: string, property: string): string | undefined =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`, 'g'))].at(-1)?.[1]?.trim()

// Council round 34 A2: on a phone Send sat 2px under the + control's line (7.8px once a 44px chip grew the row).
// Council round 35 P1 (Fable): a subagent's composer has no model chip, so its row's line was the 28px + control and Stop
// sat 2px above it; the offset is now derived from the row's own line, which the row holds at the model chip's 32px.
describe('Send on the bar\'s line (council round 34 A2, round 35 P1)', () => {
  const NARROW = '@container (max-width: 560px)'

  /** Send's and the row's centres, measured up from the card's bottom edge, for a row whose tallest chip is `chip`. */
  const centres = (pointer: 'fine' | 'coarse', chip: number) => {
    const properties = customProperties(pointer)
    // The row is a border box: its pads, then its line.
    const padding = (declaration(rules('', '.row'), 'padding') ?? '').split(/\s+/)
    const pad = lengthOf(padding[2] ?? '', properties)
    const coarseTop = declaration(rules('@media (pointer: coarse)', '.row'), 'padding-top')
    const top = pointer === 'coarse' && coarseTop !== undefined ? lengthOf(coarseTop, properties) : lengthOf(padding[0] ?? '0', properties)
    // The row's floor (narrow and phone rows only: there Send leaves the row's flow and is positioned against the card).
    const floor = declaration(rules(NARROW, '.row'), 'min-height')
    const line = Math.max(chip, floor === undefined ? 0 : lengthOf(floor, properties) - pad - top)
    const sendSize = lengthOf(declaration(rules(pointer === 'coarse' ? '@media (pointer: coarse)' : '', '.primary'), 'height') ?? '', properties)
    // The narrow rule's own offset is the first under the container query (the touch block nests its own after it).
    const fine = /(?:^|[;\s])bottom:\s*([^;]+);/.exec(rules(NARROW, '.send'))?.[1]?.trim()
    const touch = declaration(rules('@media (pointer: coarse)', '.send'), 'bottom')
    const bottom = lengthOf((pointer === 'coarse' ? (touch ?? fine) : fine) ?? '', properties)
    return { send: bottom + sendSize / 2, row: pad + line / 2 }
  }

  // 11: a parent thread's composer, whose model chip is the row's tallest item (32px). 18: a subagent's composer, whose
  // tallest item is the 28px + control (no model chip).
  it.each([
    ['a parent thread (11)', 32],
    ['a subagent thread (18)', 28],
  ] as const)('puts Send\'s centre on the row\'s centre within 0.5px in %s, on a fine pointer and on touch', (_, chip) => {
    for (const pointer of ['fine', 'coarse'] as const) {
      const { send, row } = centres(pointer, chip)
      expect(Math.abs(send - row), `${pointer}: Send ${String(send)} vs row ${String(row)}`).toBeLessThanOrEqual(0.5)
    }
  })

  it('derives the offset from the row\'s line and pad, never a bare constant', () => {
    for (const body of [rules(NARROW, '.send'), rules('@media (pointer: coarse)', '.send')]) {
      const bottom = declaration(body, 'bottom')
      if (bottom === undefined) continue
      expect(bottom).toMatch(/var\(--dsh-composer-row-line/)
      expect(bottom).toMatch(/var\(--dsh-composer-row-pad/)
    }
  })
})

describe('Stop is quiet (council round 25, item 6)', () => {
  const STOP = '.primary:is([data-send-mode=\'stop\'], [data-stop]):not(:disabled)'

  it('is a ghost circle on the card fill with the 3:1 field edge drawn inside, and an ink glyph', () => {
    const stop = rules('', STOP)
    expect(stop).toMatch(/background: transparent;/)
    expect(stop).toMatch(/box-shadow: inset 0 0 0 1px var\(--dshx-field-border, var\(--dsw-alias-border-l3\)\);/)
    expect(stop).toMatch(/color: var\(--dshx-tone-text, var\(--dsw-alias-label-primary\)\);/)
    // Hover lifts the ghost to the raised fill, never back to the solid ink disc.
    expect(rules('@media (hover: hover)', `${STOP}:hover`)).toMatch(/background: var\(--dsw-specific-selector, var\(--dshx-tone-raised\)\);/)
  })

  it('draws a 10px ink square in both Stop glyphs', () => {
    const source = readFileSync(resolve(here, 'native/skeleton/InputBar.tsx'), 'utf8')
    const squares = [...source.matchAll(/data-stop-glyph[^>]*>\s*<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(match =>
      match.slice(1).join(' '),
    )
    expect(squares).toEqual(['3 3 10 10', '3 3 10 10'])
  })

  // A continuable child with a typed draft shows Stop beside Send: 32px circles 8px apart left a 40px pitch, so the two
  // 44pt touch areas overlapped and a tap 20px right of Stop's centre landed on Send (measured at 390px in WebKit).
  it('keeps Stop\'s and Send\'s 44pt touch areas apart on a coarse pointer, inside the phone\'s two-button seat', () => {
    const gap = Number(/gap: (\d+)px;/.exec(rules('@media (pointer: coarse)', '.send'))?.[1])
    const size = Number(/width: (\d+)px;/.exec(rules('@media (pointer: coarse)', '.primary'))?.[1])
    expect(size + gap).toBeGreaterThanOrEqual(44)
    // The scrolling chip line ends one seat short of the card edge: 8px inset, both circles and the gap, 8px clear.
    const seat = Number(/--dsh-composer-send-seat: (\d+)px;/.exec(rules('@container (max-width: 560px)', '.row:has(.send > :nth-child(2))'))?.[1])
    expect(8 + size + gap + size + 8).toBeLessThanOrEqual(seat)
  })

  it.each(['light', 'dark'] as const)('keeps the edge at 3:1 and the square at 4.5:1 on the card and its hover fill (%s)', (scheme: Scheme) => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const step of [0, 1, 2]) {
      expect(PaletteMath.contrastRatio(p.fieldBorder, p.neutral[step]!)).toBeGreaterThanOrEqual(3)
      expect(PaletteMath.contrastRatio(p.neutral[10]!, p.neutral[step]!)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
