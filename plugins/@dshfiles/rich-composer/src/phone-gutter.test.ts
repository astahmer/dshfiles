import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./native/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const PHONE = '@media (max-width: 639.98px), (pointer: coarse) and (max-height: 500px)'

/** Every rule body for `selector` inside a media block that starts at `media`. */
const rulesIn = (media: string, selector: string): string[] => {
  const found: string[] = []
  for (let from = css.indexOf(media); from >= 0; from = css.indexOf(media, from + 1)) {
    const open = css.indexOf('{', from)
    let depth = 0
    let end = open
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}') depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
    for (const match of css.slice(open + 1, end).matchAll(/([^{}]+)\{([^{}]*)\}/g)) if ((match[1] ?? '').trim() === selector) found.push(match[2] ?? '')
  }
  return found
}

describe('the phone transcript gutter (council round 9, lane B B4)', () => {
  it('fills the composer, its dock and the transcript column from 12px, like every phone page', () => {
    expect(rulesIn(PHONE, ':global(html[data-shell-phone-nav]) .body:not(.embeddedBody)').join('\n')).toMatch(/--dsh-composer-side-clearance: 12px;/)
  })
})
