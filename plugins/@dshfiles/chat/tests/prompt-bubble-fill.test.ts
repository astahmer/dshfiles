import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/chat/MessageItem.module.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** Every declaration block of `selector` at the top level, joined. */
const rule = (selector: string): string =>
  [...css.matchAll(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'gu'))].map(match => match[1] ?? '').join('\n')

describe('the user prompt bubble (round six C4)', () => {
  it("fills with the kit's faint cool prompt tint, the Host bubble fill only without ui-styles", () => {
    expect(rule('.bubble')).toMatch(/background: var\(--dshx-prompt-fill, var\(--dsw-specific-bubble\)\);/u)
  })

  it('leaves the Host bubble token as it is', () => {
    expect(css).not.toMatch(/--dsw-specific-bubble:/u)
  })

  it('keeps a code-like prompt on the code block fill', () => {
    expect(rule('.bubble[data-code-like]')).toMatch(/background: var\(--dsw-alias-markdown-code-block\);/u)
  })
})
