import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const view = readFileSync(new URL('../src/native/chat/ChatView.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8')

describe('Back to bottom (round five C1, council round 5)', () => {
  it('is an arrow to the latest line, not a second disclosure chevron beside Live work (council round 9 C4)', () => {
    const control = view.slice(view.indexOf('const toBottom = ('), view.indexOf('return (', view.indexOf('const toBottom = (')))
    // arrow-down-to-line reads "jump to latest"; a bare arrow read as "expand".
    expect(control).toContain('<ArrowDownToLineIcon')
    expect(control).not.toContain('<ArrowDownIcon')
    expect(control).not.toContain('ChevronDownIcon')
  })

  it('is a 32px icon button in the dock seat, with a 44px tap area on a touch screen', () => {
    expect(css).toMatch(/\.toBottomInDock \{[^}]*--dsh-to-bottom-size: 32px;/u)
    // Council round 8 C4: the strip's flat trailing icon button, not a floating circle with a shadow.
    const rule = /\.toBottomInDock \{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(rule).toContain('box-shadow: none;')
    expect(rule).toContain('background: transparent;')
    expect(rule).toContain('border-radius: var(--dsw-radius-md, 8px);')
    expect(css).toMatch(/\.toBottomInDock::after \{[^}]*inset: -6px;/u)
  })
})
