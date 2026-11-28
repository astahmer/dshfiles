// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dockJumpSeat } from '../src/native/chat/dock-jump-seat.ts'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/native/chat/ChatView.module.css'), 'utf8')
const rule = (selector: RegExp): string => selector.exec(css)?.[1] ?? ''

describe('the "Back to bottom" control', () => {
  it('sits in the gutter beside the text column, not on its last line', () => {
    const slot = rule(/\n\.toBottomSlot \{([^}]*)\}/)
    // Half the free width minus the control and a 12px gap puts its left edge right of the column.
    expect(slot).toContain('calc((100% - var(--dsh-chat-content-width)) / 2 - var(--dsh-to-bottom-size) - 12px)')
    // The old inset ended the control flush with the column's right edge, over the text.
    expect(slot).not.toMatch(/calc\(\(100% - var\(--dsh-chat-content-width\)\) \/ 2\)\s*\)/)
    // A pane with no gutter keeps the control on the column's edge, which the dock shares (round five C3).
    expect(slot).toContain('var(--dsh-composer-side-clearance),')
    expect(slot).not.toContain('calc(var(--dsh-composer-side-clearance) + 16px)')
  })

  // Unslop round five C2 (council round 3): a 36pt circle floating over the transcript, 12pt above the dock and 16pt
  // from the edge, with a 44pt hit area on touch; no band and no hairline behind it.
  it('is a 36px circle everywhere, with a 44px hit area on touch screens, 12px above the dock', () => {
    const slot = rule(/\n\.toBottomSlot \{([^}]*)\}/)
    expect(slot).toMatch(/--dsh-to-bottom-size: 36px/)
    expect(css).not.toMatch(/--dsh-to-bottom-size: 44px/)
    const control = rule(/\n\.toBottom \{([^}]*)\}/)
    expect(control).toMatch(/width: var\(--dsh-to-bottom-size\)/)
    expect(control).toMatch(/height: var\(--dsh-to-bottom-size\)/)
    const hit = /@media \(pointer: coarse\) \{\s*\.toBottom::after \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(hit).toMatch(/inset: -4px/)
    const docked = rule(/:global\(\[data-conversation-scroll\]\) \.toBottomSlot \{([^}]*)\}/)
    expect(docked).toMatch(/bottom: calc\(var\(--dsh-composer-height, 152px\) \+ 12px\)/)
  })

  it('floats over the transcript: no band, no hairline behind it', () => {
    expect(css).not.toMatch(/\.toBottomSlot::before/)
    expect(css).not.toContain('--dsh-to-bottom-overlap')
  })

  // Round five C1 (council round 4): a phone has no gutter, so the control moves into the dock's trailing seat (the
  // composer publishes `[data-composer-jump-seat]`) and is never drawn over prose.
  it('finds the dock trailing seat of its own conversation, and none elsewhere', () => {
    const scroller = document.createElement('div')
    scroller.setAttribute('data-conversation-scroll', '')
    const frame = document.createElement('div')
    const seat = document.createElement('span')
    seat.setAttribute('data-composer-jump-seat', '')
    scroller.append(frame, seat)
    document.body.append(scroller)
    expect(dockJumpSeat(frame)).toBe(seat)
    seat.remove()
    expect(dockJumpSeat(frame)).toBeNull()
    expect(dockJumpSeat(null)).toBeNull()
    scroller.remove()
  })

  it('sits in the dock seat as a plain 36px circle, without the floating slot offset', () => {
    const docked = rule(/\n\.toBottomInDock \{([^}]*)\}/)
    expect(docked).toMatch(/margin-top: 0/)
  })
})
