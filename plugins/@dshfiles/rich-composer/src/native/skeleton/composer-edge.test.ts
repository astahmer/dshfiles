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

describe('the dock and the composer read as one field (council round 19 C2)', () => {
  // The Live work dock's top and side edges take the card's 3:1 field edge, so dock and composer share one outline;
  // the dividers inside it (between rows, and where a subagents dock joins a jobs dock) stay `border-l2` hairlines
  // (#dedcda light, #2f2c29 dark). Round 12 C1 had outlined the dock in border-l2, which read as a second, paler object.
  const FIELD = 'border: 1px solid var(--dshx-field-border, var(--dsw-alias-border-l3));'
  const HAIRLINE = 'var(--dshx-tone-line, var(--dsw-alias-border-l2))'
  const desk = `:global(html:not([data-shell-phone-nav])) .composerStack > ${DOCK} > :global([data-dshfiles-live-preview-dock])`

  it('outlines the desktop live work dock with the field edge', () => {
    expect(rule(root, desk)).toContain(FIELD)
    expect(rule(root, desk)).not.toContain('--dsw-alias-border-l2')
  })

  it('keeps the dividers inside the dock hairlines', () => {
    expect(rule(root, `${desk} > * + *`)).toContain(`border-top: 1px solid ${HAIRLINE};`)
    // A subagents dock under a jobs dock: its top border is the divider between them, not a field edge.
    expect(rule(root, `${desk} + :global([data-dshfiles-live-preview-dock])`)).toContain(`border-top-color: ${HAIRLINE};`)
  })

  it('outlines the phone Live work strip with the field edge too', () => {
    const attached = `:global(html[data-shell-phone-nav]) .composerStack:not(:has(> ${DOCK} > :not([data-dshfiles-live-preview-dock])))`
    const strip = rule(root, `${attached} > .dockHead:has(> [data-live-work-summary])`)
    expect(strip).toContain(FIELD)
    expect(strip).not.toContain('--dsw-alias-border-l2')
  })

  it('draws one seam under the attached strip: the card ring, with no top highlight of the card under it (council round 18 C4)', () => {
    const attached = `:global(html[data-shell-phone-nav]) .composerStack:not(:has(> ${DOCK} > :not([data-dshfiles-live-preview-dock])))`
    // The strip draws no bottom edge of its own.
    expect(rule(root, `${attached} > .dockHead:has(> [data-live-work-summary])`)).toContain('border-bottom-width: 0;')
    // Dark's s1 elevation carries an inset top highlight that read as a second line 1px under the ring: there the card's
    // seam layer takes the card's own fill and covers it (an earlier shadow paints on top), so the ring is the one seam.
    const card = rule(root, `${attached}:has(> .dockHead > [data-live-work-summary]) :global([data-composer-card])`)
    expect(card).toContain('--dsh-composer-card-seam: var(--dsh-composer-card-fill);')
    for (const state of ['.card', '.card:focus-within']) {
      const shadow = rule(inputBar, state)
      const seam = shadow.indexOf('inset 0 1px 0 var(--dsh-composer-card-seam, transparent)')
      expect(seam).toBeGreaterThan(shadow.indexOf(FIELD_EDGE))
      expect(seam).toBeLessThan(shadow.indexOf('var(--dshx-elevation-1'))
    }
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
