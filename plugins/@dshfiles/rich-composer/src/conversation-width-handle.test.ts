import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./native/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')

describe('no width handle on the phone (council picker round 4, T11)', () => {
  it('hides the width handles under the phone shell, so their offset never widens the transcript column', () => {
    expect(css).toMatch(/:global\(html\[data-shell-phone-nav\]\) \.widthHandle \{\s*display: none;\s*\}/u)
  })
})
