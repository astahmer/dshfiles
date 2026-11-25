import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8')
const rule = (selector: RegExp): string => selector.exec(css)?.[1] ?? ''

describe('the "Back to bottom" control', () => {
  it('sits in the gutter beside the text column, not on its last line', () => {
    const slot = rule(/\n\.toBottomSlot \{([^}]*)\}/)
    // Half the free width minus the control and a 12px gap puts its left edge right of the column.
    expect(slot).toContain('calc((100% - var(--dsh-chat-content-width)) / 2 - var(--dsh-to-bottom-size) - 12px)')
    // The old inset ended the control flush with the column's right edge, over the text.
    expect(slot).not.toMatch(/calc\(\(100% - var\(--dsh-chat-content-width\)\) \/ 2\)\s*\)/)
    // A pane with no gutter keeps the control inside the pane.
    expect(slot).toContain('calc(var(--dsh-composer-side-clearance) + 16px)')
  })

  // Unslop round five C2 (council round 2): a 44px control on the dock's edge, outside the prose; no gradient that leaves a
  // half-faded line of text above the dock.
  it('is a 44px control on touch screens, 36px with a fine pointer, 8px above the dock', () => {
    const slot = rule(/\n\.toBottomSlot \{([^}]*)\}/)
    expect(slot).toMatch(/--dsh-to-bottom-size: 36px/)
    const coarse = /@media \(pointer: coarse\) \{\s*\.toBottomSlot \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(coarse).toMatch(/--dsh-to-bottom-size: 44px/)
    const control = rule(/\n\.toBottom \{([^}]*)\}/)
    expect(control).toMatch(/width: var\(--dsh-to-bottom-size\)/)
    expect(control).toMatch(/height: var\(--dsh-to-bottom-size\)/)
    const docked = rule(/:global\(\[data-conversation-scroll\]\) \.toBottomSlot \{([^}]*)\}/)
    expect(docked).toMatch(/bottom: calc\(var\(--dsh-composer-height, 152px\) \+ 8px\)/)
  })

  it('without a gutter, ends the transcript on a solid band with a hairline, never a fade', () => {
    const band = /\n\.toBottomSlot::before \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    // From the dock's top edge to 8px above the control, in the page colour, edged by a hairline.
    expect(band).toMatch(/bottom: -8px/)
    expect(band).toMatch(/height: clamp\(0px, var\(--dsh-to-bottom-overlap\) \* 100, calc\(var\(--dsh-to-bottom-size\) \+ 16px\)\)/)
    expect(band).toMatch(/background: var\(--dsw-alias-bg-base\)/)
    expect(band).not.toContain('gradient')
    expect(band).toMatch(/box-shadow: inset 0 1px var\(--dsw-alias-border-l2/)
    expect(band).toMatch(/pointer-events: none/)
    // Zero height whenever the gutter holds the control: the overlap is measured against the frame (100cqw).
    expect(band).toMatch(/--dsh-to-bottom-overlap: calc\(\s*var\(--dsh-to-bottom-size\) \+ 12px \+ var\(--dsh-composer-side-clearance, 16px\) \+ 16px -/)
    expect(band).toContain('100cqw')
  })
})
