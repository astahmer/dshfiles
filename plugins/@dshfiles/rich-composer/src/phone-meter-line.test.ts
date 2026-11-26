import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'native/skeleton/InputBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of `selector` inside every block opening with `media`. */
const inMedia = (media: string, selector: string): string => {
  const bodies: string[] = []
  for (let from = css.indexOf(media); from >= 0; from = css.indexOf(media, from + 1)) {
    const open = css.indexOf('{', from)
    let depth = 0
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}') depth -= 1
      if (depth === 0) {
        bodies.push(...[...css.slice(open + 1, index).matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => (match[1] ?? '').trim() === selector).map(match => match[2] ?? ''))
        break
      }
    }
  }
  return bodies.join('\n')
}

describe('the phone meter line (council round 13 C5)', () => {
  it('hides the passive project/branch line under the composer on a phone, unless an entry flags an alert or messages wait', () => {
    const rule = inMedia(
      '@media (max-width: 639.98px), (pointer: coarse) and (max-height: 500px)',
      ":global(html[data-shell-phone-nav]) .root:not(.hero) > .dock:not(:has(:global([data-meter-alert]), .queued))",
    )
    expect(rule).toMatch(/display: none;/)
  })
})
