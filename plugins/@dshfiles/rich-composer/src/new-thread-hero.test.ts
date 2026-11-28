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

  it('centres heading, composer and suggestion lines as one block in a tall pane (council round 7 C7)', () => {
    expect(root).toContain('@media (min-height: 800px) and (min-width: 640px) {')
    expect(tall).toMatch(/\.composerHero \{\s*padding-bottom: 0;/u)
    // Round five centred the heading and composer only, padding the top by what hung below (48px or 88px): the whole
    // block then sat ~43px under the pane's centre at 1440x900. Nothing offsets the block now.
    expect(root).not.toMatch(/\.composerHero:has\(> \.heroSuggestions[^{]*\{\s*padding-top/u)
    expect(root).not.toMatch(/padding-top: (48|88)px;/u)
  })

  it("draws every run chip's icon in the secondary ink, leaving brand marks and project tiles their colour", () => {
    expect(bar).toMatch(/\.rowHero :global\(\[data-run-segment\]\) svg:not\(:global\(\[data-brand\]\)\) \{\s*color: var\(--dsw-alias-label-secondary\);/u)
  })
})
