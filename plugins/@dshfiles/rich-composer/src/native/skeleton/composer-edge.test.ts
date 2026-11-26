import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const source = (file: string): string => readFileSync(resolve(here, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const inputBar = source('InputBar.module.css')
const root = source('ConversationRoot.module.css')

/** The declarations of the first block whose selector is exactly `selector`. */
const rule = (css: string, selector: string): string => {
  const pattern = /([^{}]+)\{([^{}]*)\}/g
  for (let match = pattern.exec(css); match !== null; match = pattern.exec(css)) if ((match[1] ?? '').trim() === selector) return match[2] ?? ''
  return ''
}

const FIELD_EDGE = '0 0 0 1px var(--dshx-field-border, var(--dsw-alias-border-l3))'
const DOCK = ":global([data-slot='conversation.input.dock'])"

describe('the composer card edge (council round 11 C3)', () => {
  it('draws the 3:1 field edge at rest, empty or not, so the main input reads as editable as the sidebar search', () => {
    expect(rule(inputBar, '.card')).toContain(FIELD_EDGE)
    expect(rule(inputBar, '.card')).not.toContain('--dsw-alias-border-l2')
  })

  it('keeps that edge while typing (never the accent) and its shadow and highlight', () => {
    const focus = rule(inputBar, '.card:focus-within')
    expect(focus).toContain(FIELD_EDGE)
    expect(focus).toContain('var(--dshx-elevation-1, var(--dsw-elevation-soft))')
    expect(focus).not.toContain('accent')
  })

})

describe('the dock around the card stays quiet (council round 12 C1)', () => {
  // Only the editable card keeps the 3:1 field edge; the dock's outline and the dividers inside it are `border-l2`
  // (#dedcda light, #2f2c29 dark), so the line between a jobs dock and a subagents dock (the second dock's top border)
  // is no longer a 3.3:1 rule.
  const L2 = 'border: 1px solid var(--dshx-tone-line, var(--dsw-alias-border-l2));'

  it('outlines the desktop live work dock in border-l2, never the field edge', () => {
    const desk = `:global(html:not([data-shell-phone-nav])) .composerStack > ${DOCK} > :global([data-dshfiles-live-preview-dock])`
    expect(rule(root, desk)).toContain(L2)
    expect(rule(root, desk)).not.toContain('--dshx-field-border')
    // Its rows keep their quiet hairline dividers.
    expect(rule(root, `${desk} > * + *`)).toContain('border-top: 1px solid var(--dshx-tone-line, var(--dsw-alias-border-l2));')
  })

  it('outlines the phone Live work strip in border-l2, leaving the card ring as the one 3:1 edge', () => {
    const attached = `:global(html[data-shell-phone-nav]) .composerStack:not([data-live-work-open]):not(:has(> ${DOCK} > :not([data-dshfiles-live-preview-dock])))`
    const strip = rule(root, `${attached} > .dockHead:has(> [data-live-work-summary])`)
    expect(strip).toContain(L2)
    expect(strip).not.toContain('--dshx-field-border')
  })

  it('leaves no field edge anywhere in the conversation root outside the card', () => {
    expect(root).not.toContain('--dshx-field-border')
  })
})

describe('the phone meter line (council round 11 C4)', () => {
  it('keeps the "·" between the project and its state when the line truncates its location', () => {
    // The location clips its own overflow on a narrow bar, so the dot sits inside its box, not pulled 8px out of it.
    const narrow = rule(inputBar, ".dock:not([data-meter-expanded]):has(> :global([data-run-summary])) :global([data-composer-meta='location'])::before")
    expect(narrow).toContain('margin-left: 0;')
    expect(narrow).toContain('margin-right: 6px;')
  })
})
