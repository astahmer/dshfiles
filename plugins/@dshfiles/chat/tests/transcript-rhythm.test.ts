import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const chat = read('../src/native/chat/ChatView.module.css')
const tail = read('../src/native/chat/TurnTailNodeView.module.css')
const process = read('../src/native/chat/TurnProcessNodeView.module.css')
const block = (css: string, at: string): string => {
  const start = css.indexOf(at)
  if (start < 0) return ''
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(start, index + 1)
  }
  return ''
}

// Unslop round five C2 (council round 4): about 50px of nothing sat between a finished turn's last line and the live
// rows of the dock: the reply's hover-only actions row reserved 48px under the summary line, then 12px of end padding.
describe('the transcript rhythm (round five C2, council round 4)', () => {
  it('ends the transcript 24px above the dock', () => {
    const scroll = /\n\.scroll \{([^}]*)\}/.exec(chat)?.[1] ?? ''
    expect(scroll).toMatch(/padding: 16px var\(--dsh-composer-side-clearance\) 24px;/)
  })

  it("lays a reply's hover actions on the trailing end of a one-line tail row instead of a row of their own", () => {
    const hover = block(tail, '@media (hover: hover)')
    expect(hover).toMatch(/\.root\[data-actions-reveal='hover'\]:has\(> :global\(\[data-slot\]\) > :global\(\[data-chat-tail-line\]\):last-child\) \{\s*position: relative;/)
    expect(hover).toMatch(/> \.actions \{[^}]*position: absolute;[^}]*right: 0;/)
  })

  it('draws "Worked for" as a 24px row on a touch screen, with a 44px tap area that takes no room', () => {
    const coarse = block(process, '@media (pointer: coarse)')
    expect(coarse).not.toMatch(/min-height: 44px/)
    expect(coarse).toMatch(/\.root:not\(:disabled\)::after \{[^}]*inset: -10px 0;/)
  })
})
