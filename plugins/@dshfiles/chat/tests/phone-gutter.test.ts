import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (file: string): string => readFileSync(new URL(`../src/native/chat/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const PHONE = '@media (max-width: 639.98px), (pointer: coarse) and (max-height: 500px)'

/** Every rule body for `selector` inside a media block that starts at `media`. */
const rulesIn = (css: string, media: string, selector: string): string => {
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
  return found.join('\n')
}

describe('the phone transcript gutter (council round 9, lane B B4)', () => {
  const phone = ':global(html[data-shell-phone-nav])'

  it('sets bare text at 24px: the 12px fill gutter plus 12px', () => {
    expect(rulesIn(read('ChatView.module.css'), PHONE, `${phone} .scroll`)).toMatch(/padding-inline: calc\(var\(--dsh-composer-side-clearance\) \+ 12px\);/)
  })

  it('ends the transcript 32px above the dock\'s 8px fade, so the last line still sits 40px above Live work (council round 17 C4)', () => {
    expect(rulesIn(read('ChatView.module.css'), PHONE, `${phone} .scroll`)).toMatch(/padding-bottom: 32px;/)
  })

  it('pulls a code card and the prompt bubble back out to the 12px fill edge', () => {
    expect(rulesIn(read('AssistantMarkdown.module.css'), PHONE, `${phone} .body :global([data-dsh-markdown] .md-code-block)`)).toMatch(/margin-inline: -12px;/)
    expect(rulesIn(read('MessageItem.module.css'), PHONE, `${phone} .userStack`)).toMatch(/margin-right: -12px;/)
  })
})
