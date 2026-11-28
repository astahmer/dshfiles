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

describe('the transcript under the phone top bar (council round 24, item 4)', () => {
  const PHONE = '@media (max-width: 639.98px), (pointer: coarse) and (max-height: 500px)'
  const FADE = ":global(html[data-shell-phone-nav]) .body[data-content-phase='active']:not(.embeddedBody) .scrollBody:not(:has([data-conversation-composer-overlay]))::before"
  /** The body of `selector`'s rule inside any `media` block. */
  const ruleIn = (media: string, selector: string): string => {
    for (let from = css.indexOf(media); from >= 0; from = css.indexOf(media, from + 1)) {
      const at = css.indexOf(`${selector} {`, from)
      const next = css.indexOf('@media', from + 1)
      if (at >= 0 && (next < 0 || at < next)) return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
    }
    return ''
  }

  it('fades the transcript out over 8px under the bar\'s hairline, so no clipped glyph slivers show there', () => {
    // The scroller's top edge sliced the line scrolling past it: slivers of glyphs sat under the bar's hairline (17).
    const fade = ruleIn(PHONE, FADE)
    expect(fade).toMatch(/position: sticky;/)
    expect(fade).toMatch(/top: 0;/)
    expect(fade).toMatch(/height: 8px;/)
    // It takes no room and catches no touch.
    expect(fade).toMatch(/margin-bottom: -8px;/)
    expect(fade).toMatch(/pointer-events: none;/)
    expect(fade).toMatch(/linear-gradient\(180deg, var\(--dsw-alias-bg-base\), color-mix\(in srgb, var\(--dsw-alias-bg-base\) 0%, transparent\)\)/)
    // Over the transcript's text, under its sticky banners, pinned header and turn rail (6, 7).
    expect(fade).toMatch(/z-index: 5;/)
  })
})
