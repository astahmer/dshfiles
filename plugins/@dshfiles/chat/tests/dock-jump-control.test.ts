import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const view = readFileSync(new URL('../src/native/chat/ChatView.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8')

describe('Back to bottom (round five C1, council round 5)', () => {
  it('is an arrow, not a second disclosure chevron beside Live work', () => {
    const control = view.slice(view.indexOf('const toBottom = ('), view.indexOf('return (', view.indexOf('const toBottom = (')))
    expect(control).toContain('<ArrowDownIcon')
    expect(control).not.toContain('ChevronDownIcon')
  })

  it('is a 32px round button in the dock seat, with a 44px tap area on a touch screen', () => {
    expect(css).toMatch(/\.toBottomInDock \{[^}]*--dsh-to-bottom-size: 32px;/u)
    expect(css).toMatch(/\.toBottomInDock::after \{[^}]*inset: -6px;/u)
  })
})
