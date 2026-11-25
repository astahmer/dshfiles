import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8')

describe('one transcript column (round five C3)', () => {
  it('insets the transcript by the composer side clearance, so a narrow pane puts prose and the composer card on one edge', () => {
    const scroll = /\n\.scroll \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(scroll).toMatch(/padding: 16px var\(--dsh-composer-side-clearance\) 12px;/)
    expect(scroll).not.toContain('var(--dsh-composer-side-clearance) + 16px')
  })
})

describe('the end of the transcript (round five C3)', () => {
  const actions = readFileSync(new URL('../src/native/chat/MessageIconActions.module.css', import.meta.url), 'utf8')

  it("reveals every reply's actions on hover or focus with a pointer, the latest included: no orphan copy and ⋯ row (round five C1, council round 3)", () => {
    const hover = actions.slice(actions.indexOf('@media (hover: hover) {'))
    // No rule pins the latest turn tail's actions visible at rest.
    expect(actions).not.toMatch(/\[data-chat-flow-kind='turn-tail'\]:not\(:has\(~/u)
    expect(hover).toMatch(/\[data-actions-reveal='hover'\] \.actions,[^{]*\{\s*opacity: 0;/u)
    expect(hover).toMatch(/\[data-actions-reveal='hover'\]:hover \.actions,\s*\[data-actions-reveal='hover'\]:focus-within \.actions,/u)
  })

  it('ends the scroll range 12px below the last row, not 16px', () => {
    const scroll = /\n\.scroll \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(scroll).toMatch(/padding: 16px var\(--dsh-composer-side-clearance\) 12px;/)
  })
})
