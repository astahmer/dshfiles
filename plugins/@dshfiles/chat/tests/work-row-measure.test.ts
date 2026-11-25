import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const chatView = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8')
const turnProcess = readFileSync(new URL('../src/native/chat/TurnProcessNodeView.module.css', import.meta.url), 'utf8')
const rule = (css: string, selector: string): string => new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''

describe('work rows in the transcript (DESIGN.md, layout: transcript measure)', () => {
  it('publishes the prose measure on the message column in pixels of the prose size', () => {
    // A bare `44em` would resolve at each use site: 44 x 13px on a tool row, not the 44 x 14px the prose stops at.
    // Round five C1 (council round 3): 44em of Geist is about 66ch (616px at 14px), one column with the 680px cards.
    expect(rule(chatView, '.column')).toContain(
      '--dsh-chat-prose-measure: calc(44 * max(var(--dsh-content-font-size, 14px), var(--dshx-density-text-prose, 14px)));',
    )
  })

  it('stops prose at about 66ch, not the 34em that left it 200px short of the cards (round five C1)', () => {
    const markdown = readFileSync(new URL('../src/native/chat/AssistantMarkdown.module.css', import.meta.url), 'utf8')
    expect(markdown).toMatch(/> :where\(p, ul, ol, blockquote, h1, h2, h3, h4, h5, h6, details\) \{\s*max-inline-size: 66ch;/u)
    expect(markdown).not.toContain('max-inline-size: 34em')
  })

  it('draws "Worked for" as wide as its label, never across the column', () => {
    const root = rule(turnProcess, '.root')
    expect(root).toContain('width: fit-content;')
    expect(root).toContain('max-width: var(--dsh-chat-prose-measure, 100%);')
    expect(root).not.toContain('width: 100%;')
  })
})
