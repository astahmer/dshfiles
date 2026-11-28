import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const view = readFileSync(new URL('../src/native/chat/ChatView.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8')

describe('Back to bottom (round five C1, council round 5)', () => {
  it('is a plain down arrow, not an arrow to a line ("download") or a disclosure chevron (council round 10 C1)', () => {
    const control = view.slice(view.indexOf('const toBottom = ('), view.indexOf('return (', view.indexOf('const toBottom = (')))
    expect(control).toContain('<ArrowDownIcon')
    expect(control).not.toContain('ArrowDownToLineIcon')
    expect(control).not.toContain('ChevronDownIcon')
  })

  it('sits in a 28px round seat on the dock, filled like the composer\'s + circle, with a 44px tap area on touch', () => {
    const rule = /\.toBottomInDock \{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(rule).toContain('--dsh-to-bottom-size: 28px;')
    expect(rule).toContain('border-radius: 999px;')
    // The composer's + control's seat (InputBar `.add`): the selector fill, primary glyph, no floating shadow.
    expect(rule).toContain('background: var(--dsw-specific-selector);')
    expect(rule).toContain('color: var(--dsw-alias-label-primary);')
    expect(rule).toContain('box-shadow: none;')
    expect(css).toMatch(/\.toBottomInDock::after \{[^}]*inset: -8px;/u)
  })
})
