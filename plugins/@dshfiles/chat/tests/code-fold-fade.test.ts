import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/code-fold.module.css', import.meta.url), 'utf8')

describe('an unwrapped code card (round five C2, council round 5)', () => {
  it('fades its last 16px, so a line that runs on reads as scrollable', () => {
    expect(css).toMatch(
      /\.fold :global\(\.md-code-block\[data-code-wrap='false'\]\) pre \{[^}]*mask-image: linear-gradient\(to right, black calc\(100% - 16px\), transparent\);/u,
    )
  })

  it('draws no scrollbar under the card on a touch screen, where the fade and a swipe carry the scroll', () => {
    const touch = css.slice(css.indexOf('@media (pointer: coarse) {'))
    expect(touch).toMatch(/\.fold :global\(\.md-code-block\[data-code-wrap='false'\]\) pre \{[^}]*scrollbar-width: none;/u)
    expect(touch).toMatch(/\.fold :global\(\.md-code-block\[data-code-wrap='false'\]\) pre::-webkit-scrollbar \{[^}]*display: none;/u)
  })

  it('keeps the fold fade when it is folded too, both masks intersected', () => {
    expect(css).toMatch(/\.fold\[data-code-fold='closed'\] :global\(\.md-code-block\[data-code-wrap='false'\]\) pre \{[^}]*mask-composite: intersect;/u)
  })
})

describe("the transcript's fence seat (round five C2, council round 5)", () => {
  const view = readFileSync(new URL('../src/native/chat/ChatView.tsx', import.meta.url), 'utf8')
  const renderCode = view.slice(view.indexOf('const renderCode = useCallback('), view.indexOf('}), [renderSlot, codeLabels])'))

  it('hands every plain fence to CodeFold, so a card defaults to no-wrap with the toolbar toggle', () => {
    // The seat returned a bare FenceCodeBlock, whose card kept the native wrapped default: CodeFold never saw it.
    expect(renderCode).toMatch(/<CodeFold\s+block=\{\s*<CodeBlock/u)
    expect(renderCode).not.toContain('<FenceCodeBlock')
  })
})
