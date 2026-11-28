import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'native/skeleton/InputBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const PHONE = '@media (max-width: 639.98px), (pointer: coarse) and (max-height: 500px)'

/** Rule bodies for `selector` inside every block that opens with `media` (or at the top level when `media` is ''). */
const rules = (media: string, selector: string): string => {
  const scopes: string[] = []
  if (media === '') scopes.push(css)
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

describe('the phone composer at rest (council round 10 C1)', () => {
  const phone = ':global(html[data-shell-phone-nav])'

  it('is a 76px block when empty: no top pad, a 36px text line, then the 40px bar', () => {
    expect(rules(PHONE, `${phone} .root:not(.hero) .card`)).toMatch(/padding-top: 0;/)
    const input = rules(PHONE, `${phone} .root:not(.hero) .input`)
    expect(input).toMatch(/min-height: 36px;/)
    expect(input).toMatch(/padding-block: 6px;/)
    // The placeholder rides the same pads, so the first keystroke does not move the line.
    expect(rules(PHONE, `${phone} .root:not(.hero) .placeholder`)).toMatch(/top: 6px;/)
  })

  it('still grows with the draft: a floor, never a fixed height', () => {
    const input = rules(PHONE, `${phone} .root:not(.hero) .input`)
    expect(input).not.toMatch(/(?<!min-|max-)height:/)
  })
})
