import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/client/AppFrame.module.css'), 'utf8')

/** The declarations of the phone pill row (`[data-status-strip='compact']` under the phone navigation). */
const pillRow = (): string => {
  const start = css.indexOf(":global([data-shell-phone-nav]) .statusStrip[data-status-strip='compact'] {")
  return css.slice(start, css.indexOf('}', start))
}

describe('phone status pill never covers content (round five P3)', () => {
  it('keeps the pill in its own row, never over the stage', () => {
    const base = css.slice(css.indexOf('.statusStrip {'), css.indexOf('}', css.indexOf('.statusStrip {')))
    expect(base).toContain('grid-area: 3 / 1 / 4 / -1')
    expect(pillRow()).not.toMatch(/position:\s*(absolute|fixed)/u)
  })

  it('reserves the home-indicator safe area when no tab bar sits below it', () => {
    expect(pillRow()).toMatch(/padding-bottom: max\(2px, calc\(env\(safe-area-inset-bottom, 0px\) - var\(--dsh-phone-nav-height, 0px\)\)\)/u)
    expect(pillRow()).toMatch(/height: calc\(44px \+ max\(0px, env\(safe-area-inset-bottom, 0px\) - var\(--dsh-phone-nav-height, 0px\)\)\)/u)
  })

  it('shows only on the Threads and Inbox screens, so a thread and Settings get the height back (round five C1)', () => {
    const start = css.indexOf(':global(html[data-phone-in-thread]) .statusStrip')
    expect(start).toBeGreaterThan(-1)
    const rule = css.slice(start, css.indexOf('}', start))
    // A thread on the stage: no tab bar, the composer owns the bottom edge.
    expect(rule).toContain(':global(html[data-phone-in-thread]) .statusStrip')
    // A tab bar whose current tab is neither Threads nor Inbox (Land, More, Settings and other pages opened from More).
    expect(rule).toContain(
      ":global(html:has([data-phone-tab-bar]):not(:has([data-phone-tab='threads'][aria-current='page'], [data-phone-tab='inbox'][aria-current='page']))) .statusStrip",
    )
    expect(rule).toContain('display: none')
    // The rule sits in the phone block, after the pill row it hides.
    expect(start).toBeGreaterThan(css.indexOf(":global([data-shell-phone-nav]) .statusStrip[data-status-strip='compact'] {"))
  })

  it('ends the scrolling stage on a hairline, so content above the pill reads as ended rather than covered', () => {
    expect(pillRow()).toContain('border-top: 1px solid var(--dsw-alias-border-l2')
    expect(pillRow()).not.toContain('border-top: none')
  })
})
