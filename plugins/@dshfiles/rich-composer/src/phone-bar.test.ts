import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./native/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the top-level rule whose selector is exactly `selector`. */
const rule = (selector: string): string => {
  const start = css.indexOf(`\n${selector} {`)
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
}

describe("the phone thread's ⋯ seat (council round 22, item 4)", () => {
  it('stays in the top bar row when a child thread\'s "Subagent of …" strip grows the top height', () => {
    // The shell publishes --dsh-phone-top-height as the bar plus the strip under it (--dsh-phone-top-strip, 0px except
    // on a child thread): `height - 44px` alone put the ⋯ over the strip, a row below the bar.
    expect(rule('.phoneBar')).toMatch(/top: calc\(var\(--dsh-phone-top-height, 44px\) - 44px - var\(--dsh-phone-top-strip, 0px\)\);/)
  })
})
