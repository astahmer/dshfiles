import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8')

describe('the "Back to bottom" control', () => {
  it('sits in the gutter beside the text column, not on its last line', () => {
    const slot = /\n\.toBottomSlot \{([^}]*)\}/.exec(css)?.[1] ?? ''
    // Half the free width minus the control (34px) and a 12px gap puts its left edge right of the column.
    expect(slot).toContain('calc((100% - var(--dsh-chat-content-width)) / 2 - 34px - 12px)')
    // The old inset ended the control flush with the column's right edge, over the text.
    expect(slot).not.toMatch(/calc\(\(100% - var\(--dsh-chat-content-width\)\) \/ 2\)\s*\)/)
    // A pane with no gutter keeps the control inside the pane.
    expect(slot).toContain('calc(var(--dsh-composer-side-clearance) + 16px)')
  })

  // Unslop r5 C2: on a phone the control floated over the last line of prose, 16px above the dock.
  it('rests 12px above the dock and, without a gutter, in a band of its own that the prose fades under', () => {
    const docked = /:global\(\[data-conversation-scroll\]\) \.toBottomSlot \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(docked).toMatch(/bottom: calc\(var\(--dsh-composer-height, 152px\) \+ 12px\)/)
    const band = /\n\.toBottomSlot::before \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    // From the dock's top edge to 12px above the 34px control, in the page colour.
    expect(band).toMatch(/bottom: -12px/)
    expect(band).toMatch(/height: clamp\(0px, var\(--dsh-to-bottom-overlap\) \* 100, 58px\)/)
    expect(band).toMatch(/var\(--dsw-alias-bg-base\) 12px/)
    expect(band).toMatch(/pointer-events: none/)
    // Zero height whenever the gutter holds the control: the overlap is measured against the frame (100cqw).
    expect(band).toMatch(/--dsh-to-bottom-overlap: calc\(\s*34px \+ 12px \+ var\(--dsh-composer-side-clearance, 16px\) \+ 16px -/)
    expect(band).toContain('100cqw')
  })
})
