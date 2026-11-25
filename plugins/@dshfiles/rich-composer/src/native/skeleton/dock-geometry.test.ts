import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'ConversationRoot.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every innermost declaration block with its selector text, at any nesting depth, plus the at-rules around it. */
const blocks = (): readonly { readonly selector: string; readonly body: string; readonly context: string }[] => {
  const found: { selector: string; body: string; context: string }[] = []
  const rule = /([^{}]+)\{([^{}]*)\}/g
  for (let match = rule.exec(css); match !== null; match = rule.exec(css)) {
    // The at-rules still open at this block: walk the braces before it, keeping a stack of their preludes.
    const open: string[] = []
    for (const token of css.slice(0, match.index).matchAll(/([^{}]*)([{}])/g)) {
      if (token[2] === '{') open.push((token[1] ?? '').trim())
      else open.pop()
    }
    found.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '', context: open.filter(prelude => prelude.startsWith('@')).join(' ') })
  }
  return found
}

const DOCK = ":global([data-slot='conversation.input.dock'])"

describe('composer dock geometry', () => {
  // C4/C11: the kit's dock row and core's goal strip took the card width minus four dock insets, 16px inside the
  // composer card on each side, while subagent rows matched the card.
  it('gives every dock row and the goal strip the composer card edges', () => {
    const rule = blocks().find(block => block.selector.startsWith(`.composerStack > ${DOCK}`)
      && block.selector.includes("[data-slot='composer-row'][data-variant='card']")
      && block.selector.includes('[data-goal-bar]'))
    expect(rule?.body).toMatch(/--dsh-composer-dock-inset:\s*0px/)
  })

  // Phone: a closed disclosure whose rows are all `w-full` has no content width and shrank to its 2px border.
  it('gives a closed entry a 10rem floor on the phone', () => {
    const entries = blocks().filter(block => block.selector === `:global(html[data-shell-phone-nav]) .composerStack > ${DOCK} > *`
      && block.context.startsWith('@media (max-width: 639.98px)'))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.body).toMatch(/flex:\s*1 1 10rem/)
    expect(entries[0]?.body).not.toMatch(/flex:\s*0 1 auto/)
  })

  it('fades an entry in without moving the input, and only fades under reduced motion', () => {
    const entry = `.composerStack > ${DOCK} > *`
    const start = blocks().filter(block => block.selector === entry && block.context.includes('@starting-style'))
    expect(start.find(block => !block.context.includes('prefers-reduced-motion'))?.body).toMatch(/opacity:\s*0/)
    expect(start.find(block => block.context.includes('prefers-reduced-motion'))?.body).toMatch(/translate:\s*none/)
    const reduced = blocks().find(block => block.selector === entry && block.context === '@media (prefers-reduced-motion: reduce)')
    expect(reduced?.body).not.toMatch(/translate/)
    // Height never animates here: the seat is pinned to the floor and must not resize under the pointer in steps.
    for (const block of blocks().filter(candidate => candidate.selector === entry)) expect(block.body).not.toMatch(/height|grid-template-rows/)
  })
})

describe('one transcript column (round five C3)', () => {
  const block = (selector: string): string => blocks().find(candidate => candidate.selector === selector && candidate.context === '')?.body ?? ''

  it('sets the default column at 680px, so code, cards and the turn summary share one column with ~66ch prose (round five C1)', () => {
    expect(block('.body')).toMatch(/--dsh-chat-content-width:\s*var\(--dsh-chat-user-width, 680px\);/)
  })

  it('gives the dock and the composer card the transcript column edges, not 16px more on each side', () => {
    expect(block('.body')).toMatch(/--dsh-composer-card-max-width:\s*var\(--dsh-chat-content-width\);/)
    expect(block('.embeddedBody')).toMatch(/--dsh-composer-card-max-width:\s*var\(--dsh-chat-content-width\);/)
  })
})

describe('the new-thread hero (round five C4, council round 3)', () => {
  const block = (selector: string): string => blocks().find(candidate => candidate.selector === selector && candidate.context === '')?.body ?? ''

  it('starts its navigation line 12px below the composer and keeps the starters on their own line', () => {
    expect(block('.heroSuggestions')).toMatch(/padding: 12px var\(--dsh-composer-side-clearance\) 0;/)
    expect(block('.heroSuggestions')).toMatch(/row-gap: 12px;/)
  })

  it('draws Resume, Review and Inbox as quiet 28px links, not outlined cards', () => {
    const nav = block(".heroSuggestions :global([data-hero-card]:not([data-hero-card^='starter-']))")
    expect(nav).toMatch(/height: 28px;/)
    expect(nav).toMatch(/border-color: transparent;/)
  })
})
