import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const view = readFileSync(new URL('../src/native/chat/ChatView.module.css', import.meta.url), 'utf8')
const message = readFileSync(new URL('../src/native/chat/MessageItem.module.css', import.meta.url), 'utf8')
const hoverBlocks = (css: string): string => css.split('@media (hover: hover)').slice(1).join('\n')

describe('transcript rhythm (round five C3, council round 5)', () => {
  it('puts "Worked for" 24px under the prompt bubble where the prompt\'s actions only show on hover', () => {
    // The hover-only actions row (28px plus the row's 6px gap) sat in the flow, so the bubble and "Worked for" were 50px
    // apart; it now overlays the space under the bubble, and the flow gap is the 24px.
    expect(hoverBlocks(view)).toMatch(/\.flowItem\[data-chat-flow-kind="user"\] \+ \.flowItem\[data-chat-flow-kind="turn-process"\] \{\s*--dsh-chat-flow-gap: 24px;/u)
    expect(hoverBlocks(message)).toMatch(
      /:global\(\[data-chat-flow-kind='user'\]\):has\(\+ :global\(\[data-chat-flow-kind='turn-process'\]\)\) \.userRow > :global\(\[data-clock\]\) \{[^}]*position: absolute;[^}]*top: calc\(100% \+ 6px\);/u,
    )
  })

  it('draws an unread label as 11px accent text, with no rules beside it', () => {
    const label = view.slice(view.indexOf('.flowItem[data-chat-unread-label]::before {'), view.indexOf('}', view.indexOf('.flowItem[data-chat-unread-label]::before {')))
    expect(label).toContain('font-size: 11px;')
    expect(label).toContain('color: var(--dshx-tone-info')
    expect(label).not.toContain('linear-gradient')
  })
})
