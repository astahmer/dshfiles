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
})
