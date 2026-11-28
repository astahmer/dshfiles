import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/chat/AssistantMarkdown.module.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`)
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
}

// Unslop round five, C4: the transcript's reading rhythm and its dark code cards.
describe('assistant prose and code cards', () => {
  it('leads prose at 1.62 of its size, so a larger Settings font size keeps the same rhythm', () => {
    expect(rule('.root')).toMatch(/line-height: 1\.62;/)
  })

  it('puts a dark code card on the raised surface with a 1px hairline that costs no layout', () => {
    const card = rule(':global(body[data-ds-dark-theme]) .body :global([data-dsh-markdown] .md-code-block)')
    expect(card).toMatch(/background-color: var\(--dshx-tone-raised\)/)
    expect(card).toMatch(/outline: 1px solid var\(--dshx-tone-line\)/)
    expect(card).toMatch(/outline-offset: -1px/)
    expect(card).not.toMatch(/\bborder:/)
    // The sticky header band is the same surface and draws the hairline's top and sides over the card's outline.
    const banner = rule(':global(body[data-ds-dark-theme]) .body :global([data-dsh-markdown] .md-code-block [data-code-block-banner])')
    expect(banner).toMatch(/background-color: var\(--dshx-tone-raised\)/)
    expect(banner).toMatch(/inset 0 1px 0 var\(--dshx-tone-line\)/)
  })
})
