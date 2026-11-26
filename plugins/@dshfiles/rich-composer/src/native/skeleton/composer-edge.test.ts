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

  it('gives the desktop live work dock on its top the same edge, so dock and card are one outlined object', () => {
    const desk = `:global(html:not([data-shell-phone-nav])) .composerStack > ${DOCK} > :global([data-dshfiles-live-preview-dock])`
    expect(rule(root, desk)).toContain('border: 1px solid var(--dshx-field-border, var(--dsw-alias-border-l3));')
    // Its rows keep their quiet hairline dividers.
    expect(rule(root, `${desk} > * + *`)).toContain('border-top: 1px solid var(--dshx-tone-line, var(--dsw-alias-border-l2));')
  })
})
