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

  it("keeps the latest reply's actions at rest, so the row above the dock is content rather than an empty band", () => {
    const latest =
      /\[data-chat-flow-kind='turn-tail'\]:not\(:has\(~ :is\(\[data-chat-flow-kind='turn-tail'\], \[data-chat-flow-kind='user'\], \[data-chat-flow-kind='turn-trigger'\]\)\)\)\s+\[data-actions-reveal='hover'\] \.actions \{\s*opacity: 1;/u
    expect(actions).toMatch(latest)
    // Earlier replies still reveal theirs on hover.
    expect(actions).toMatch(/\[data-actions-reveal='hover'\] \.actions,/u)
  })

  it('ends the scroll range 12px below the last row, not 16px', () => {
    const scroll = /\n\.scroll \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(scroll).toMatch(/padding: 16px var\(--dsh-composer-side-clearance\) 12px;/)
  })
})
