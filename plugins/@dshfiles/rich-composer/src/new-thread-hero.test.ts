import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = readFileSync(new URL('./native/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')
const bar = readFileSync(new URL('./native/skeleton/InputBar.module.css', import.meta.url), 'utf8')
const tall = root.slice(root.indexOf('@media (min-height: 800px) and (min-width: 640px) {'))

describe('the New thread hero (round five C5, council round 5)', () => {
  it('puts the heading 24px above the composer: 16px under it plus the stack gap', () => {
    expect(root).toMatch(/\.composerHero > :global\(\[data-hero-shell\]\) \{\s*margin-bottom: 16px;/u)
    // The phone stack orders the heading above the suggestions, so it keeps the stack's own gap there.
    expect(root).toMatch(/:global\(html\[data-shell-phone-nav\]\) \.composerHero > :global\(\[data-hero-shell\]\) \{[^}]*margin-bottom: 0;/u)
  })

  it('centres the heading and the composer in a tall pane, with the suggestions hanging below', () => {
    expect(root).toContain('@media (min-height: 800px) and (min-width: 640px) {')
    expect(tall).toMatch(/\.composerHero \{\s*padding-bottom: 0;/u)
    // One line of suggestions under the composer (8px gap, 12px inset, a 28px line), or both lines (12px between).
    expect(tall).toMatch(/\.composerHero:has\(> \.heroSuggestions :global\(\[data-hero-card\]\)\) \{\s*padding-top: 48px;/u)
    expect(tall).toMatch(/\{\s*padding-top: 88px;/u)
  })

  it("draws every run chip's icon in the secondary ink, leaving brand marks and project tiles their colour", () => {
    expect(bar).toMatch(/\.rowHero :global\(\[data-run-segment\]\) svg:not\(:global\(\[data-brand\]\)\) \{\s*color: var\(--dsw-alias-label-secondary\);/u)
  })
})
