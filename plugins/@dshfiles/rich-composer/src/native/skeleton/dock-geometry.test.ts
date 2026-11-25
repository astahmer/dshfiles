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

describe('the desktop live work dock (round six C2)', () => {
  const DESK = `:global(html:not([data-shell-phone-nav])) .composerStack > ${DOCK} > :global([data-dshfiles-live-preview-dock])`
  const rule = (selector: string): string => blocks().find(candidate => candidate.selector === selector)?.body ?? ''

  it('draws running jobs and working subagents on one neutral surface with the composer card edges', () => {
    const surface = rule(DESK)
    expect(surface).toMatch(/background: var\(--dshx-tone-panel, var\(--dsw-alias-bg-layer-1\)\);/)
    expect(surface).toMatch(/border: 1px solid var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
    // Council round 7 C6: the composer draws its hairline as a 1px ring outside its box, so the dock's border box is 1px
    // wider on each side to share the composer's exact edges (it sat 1px inside them).
    expect(surface).toMatch(/width: calc\(100% - var\(--dsh-composer-side-clearance, 0px\) \* 2 \+ 2px\);/)
    expect(surface).toMatch(/max-width: calc\(var\(--dsh-composer-card-max-width\) \+ 2px\);/)
  })

  it('joins a jobs dock and a subagents dock that follow each other under one 1px divider', () => {
    expect(rule(`${DESK}:has(+ :global([data-dshfiles-live-preview-dock]))`)).toMatch(/border-bottom-width: 0;/)
    const second = rule(`${DESK} + :global([data-dshfiles-live-preview-dock])`)
    expect(second).toMatch(/margin-top: calc\(-1 \* var\(--dsh-composer-stack-gap\)\);/)
    expect(second).toMatch(/border-top-left-radius: 0;/)
    expect(rule(`${DESK} > * + *`)).toMatch(/border-top: 1px solid var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
  })

  it('drops each row\'s own card frame and keeps a collapsed row 32px', () => {
    const rows = rule(`${DESK} > :is(:global([data-dshfiles-live-preview]), :global([data-dshfiles-live-preview-fold]))`)
    expect(rows).toMatch(/border: 0;/)
    expect(rows).toMatch(/margin-block: 0;/)
    expect(rows).toMatch(/border-radius: 0;/)
    const jobLine = blocks().find(candidate => candidate.selector === `${DESK} :global([data-slot='composer-row']) > :global(div:first-child)`)
    expect(jobLine?.context).toBe('@media (pointer: fine)')
    expect(jobLine?.body).toMatch(/height: 32px;/)
  })

  it('ends 8px above the composer', () => {
    expect(rule(`${DESK}:last-child`)).toMatch(/margin-bottom: calc\(8px - var\(--dsh-composer-stack-gap\)\);/)
  })
})

describe('the new-thread hero centre (round six C5)', () => {
  it('centres the heading and composer on the whole pane, not on the pane under the blank header', () => {
    // At 1440x900 the pair sat 366px under the tab strip and 329px over the status bar: it was centred in the scroll
    // body, under the blank 36px header row, so the pane read bottom-heavy. Half the header's height goes back. The rule
    // keys on the main body: under Workbench the content is not inside the `.root` that holds the header.
    const rule = blocks().find(block => block.selector === ".body:not(.embeddedBody)[data-content-phase='hero'] .composerHero")
    expect(rule?.context).toBe('@media (min-height: 800px) and (min-width: 640px)')
    expect(rule?.body).toMatch(/padding-bottom: 36px;/)
    expect(css).not.toContain('.root:has(.headerBlank)')
  })
})

describe('the phone transcript fade above the dock (council round 7 C3)', () => {
  it('fades over 36px (1.5 lines), opaque exactly where the dock surface starts, so no line shows as a sliced strip', () => {
    const rule = blocks().find(
      block =>
        block.selector === ":global(html[data-shell-phone-nav]) .body[data-content-phase='active'] .composerSeat" &&
        block.context.startsWith('@media (max-width: 639.98px)'),
    )
    expect(rule?.body).toMatch(/padding-top: 36px;/)
    // The last stop is the seat's padding edge: the band never ends early (it was opaque from 20px of a 24px pad).
    expect(rule?.body).toMatch(/var\(--dsw-alias-bg-base\) 36px\s*\)/)
    expect(rule?.body).not.toMatch(/var\(--dsw-alias-bg-base\) 20px/)
  })
})

describe('the desktop live work dock seats (council round 7 C6)', () => {
  it('reserves a job row the subagent row\'s leading seat when the dock holds subagents: both glyphs 28px into the row', () => {
    const rule = blocks().find(
      block =>
        block.selector ===
        `:global(html:not([data-shell-phone-nav])) .composerStack > ${DOCK}:has(> :global([data-dshfiles-live-preview-dock='subagents'])) > :global([data-dshfiles-live-preview-dock='jobs']) :global([data-slot='composer-row-icon'])`,
    )
    // The subagent row: 8px inset + 14px chevron + 6px gap; the job row: 10px inset + 18px (measured 568.5 vs 562.5 at 24px).
    expect(rule?.body).toMatch(/margin-inline-start: 18px;/)
  })
})
