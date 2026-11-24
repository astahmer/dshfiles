import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const chatView = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8')
const turnProcess = readFileSync(new URL('../src/native/chat/TurnProcessNodeView.module.css', import.meta.url), 'utf8')
const rule = (css: string, selector: string): string => new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('work rows in the transcript (DESIGN.md, layout: transcript measure)', () => {
  it('publishes the prose measure on the message column in pixels of the prose size', () => {
    // A bare `34em` would resolve at each use site: 34 x 13px on a tool row, not the 34 x 14px the prose stops at.
    expect(rule(chatView, '.column')).toContain(
      '--dsh-chat-prose-measure: calc(34 * max(var(--dsh-content-font-size, 14px), var(--dshx-density-text-prose, 14px)));',
    )
  })

  it('draws "Worked for" as wide as its label, never across the column', () => {
    const root = rule(turnProcess, '.root')
    expect(root).toContain('width: fit-content;')
    expect(root).toContain('max-width: var(--dsh-chat-prose-measure, 100%);')
    expect(root).not.toContain('width: 100%;')
  })
})
