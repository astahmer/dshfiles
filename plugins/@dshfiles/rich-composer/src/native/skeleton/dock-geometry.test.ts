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
    expect(block('.heroSuggestions')).toMatch(/row-gap: 8px;/)
  })

  it('draws Resume, Review and Inbox in one chip style: 32px, radius 8, raised fill, no border, 12px padding, 8px apart (council round 13 C6)', () => {
    const chip = block('.heroSuggestions :global([data-hero-card])')
    expect(chip).toMatch(/height: 32px;/)
    expect(chip).toMatch(/border: 0;/)
    expect(chip).toMatch(/border-radius: var\(--dsw-radius-md\);/)
    expect(chip).toMatch(/background: var\(--dshx-tone-raised, var\(--dsw-alias-bg-module-platform\)\);/)
    expect(chip).toMatch(/padding-inline: 12px;/)
    expect(chip).toMatch(/gap: 8px;/)
    expect(blocks().find(candidate => candidate.selector === '.heroSuggestions :global([data-hero-card]):hover' && candidate.context === '@media (hover: hover)')?.body).toMatch(/background: var\(--dshx-tone-selected, var\(--dsw-specific-sidebar-nav-item-active\)\);/)
    expect(block('.heroSuggestions')).toMatch(/column-gap: 8px;/)
    // The old split (a hairline on the navigation chips only) is gone.
    expect(blocks().filter(candidate => candidate.selector.startsWith(".heroSuggestions :global([data-hero-card]:not("))).toHaveLength(0)
  })

  // Council round 16 C1: the starters under them are lighter text-and-icon actions, unfilled until hovered.
  it('leaves the starters unfilled at rest, with 8px padding and a 6px gap (council round 16 C1)', () => {
    const starter = block(".heroSuggestions :global([data-hero-card^='starter-'])")
    expect(starter).toMatch(/background: none;/)
    expect(starter).toMatch(/padding-inline: 8px;/)
    expect(starter).toMatch(/gap: 6px;/)
  })

  // A phone stacks the hero entries in one column: a wrapping column sent the starters' 100% basis into a second column
  // off the right edge (x 347 of 390).
  it('keeps the starters in the phone column, under Resume and Inbox (council round 16 C1)', () => {
    const phone = (selector: string): string => blocks().find(candidate => candidate.selector === selector && candidate.context.startsWith('@media (max-width: 639.98px)'))?.body ?? ''
    expect(phone(':global(html[data-shell-phone-nav]) .heroSuggestions')).toMatch(/flex-direction: column;\s*flex-wrap: nowrap;/)
    const starters = phone(':global(html[data-shell-phone-nav]) .heroSuggestions :global([data-starter-row])')
    expect(starters).toMatch(/flex-basis: auto;/)
    expect(starters).toMatch(/justify-content: flex-start;/)
  })

  // Council round 14 C4: the 16px hairline between the two lines read as a stray dash; space alone separates them.
  it('separates Resume/Inbox from the starters by 14px of space, with no divider (council round 14 C4)', () => {
    expect(blocks().filter(candidate => candidate.selector.includes('[data-starter-row])::before'))).toHaveLength(0)
    // The 8px row gap plus 6px on the starter line, only when a navigation line is above it.
    expect(block(".heroSuggestions:has(:global([data-hero-card]:not([data-hero-card^='starter-']))) :global([data-starter-row])")).toMatch(/margin-top: 6px;/)
  })
})

describe('the desktop live work dock (round six C2)', () => {
  const DESK = `:global(html:not([data-shell-phone-nav])) .composerStack > ${DOCK} > :global([data-dshfiles-live-preview-dock])`
  const rule = (selector: string): string => blocks().find(candidate => candidate.selector === selector)?.body ?? ''

  it('draws running jobs and working subagents on one neutral surface with the composer card edges', () => {
    const surface = rule(DESK)
    // Council round 8 C3: the composer card's own fill and radius, so the dock reads as the composer's top.
    expect(surface).toMatch(/background: var\(--dsw-specific-input-major\);/)
    expect(surface).toMatch(/border-radius: var\(--dsw-radius-lg\);/)
    // Council round 19 C2: the card's 3:1 field edge, so dock and composer read as one field (composer-edge.test.ts).
    expect(surface).toMatch(/border: 1px solid var\(--dshx-field-border, var\(--dsw-alias-border-l3\)\);/)
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
    // The divider between them stays a hairline, not the field edge.
    expect(second).toMatch(/border-top-color: var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
    expect(rule(`${DESK} > * + *`)).toMatch(/border-top: 1px solid var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
  })

  it('keeps the hairline between dock rows after each row drops its own frame (round seven)', () => {
    // The row rule's `border: 0` came after the `> * + *` divider with a higher specificity, so desktop rows lost it.
    const ROWS = ":is(:global([data-dshfiles-live-preview]), :global([data-dshfiles-live-preview-fold]))"
    const all = blocks()
    const frame = all.findIndex(block => block.selector === `${DESK} > ${ROWS}`)
    const divider = all.findIndex(block => block.selector === `${DESK} > * + ${ROWS}`)
    expect(frame).toBeGreaterThan(-1)
    expect(divider).toBeGreaterThan(frame)
    expect(all[divider]?.body).toMatch(/border-top: 1px solid var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
  })

  it('drops each row\'s own card frame and keeps a collapsed row 32px', () => {
    const rows = rule(`${DESK} > :is(:global([data-dshfiles-live-preview]), :global([data-dshfiles-live-preview-fold]))`)
    expect(rows).toMatch(/border: 0;/)
    expect(rows).toMatch(/margin-block: 0;/)
    expect(rows).toMatch(/border-radius: 0;/)
    const jobLine = blocks().find(candidate => candidate.selector === `${DESK} :global([data-slot='composer-row']) > :global(div:first-child)` && candidate.context !== '')
    expect(jobLine?.context).toBe('@media (pointer: fine)')
    expect(jobLine?.body).toMatch(/height: 32px;/)
  })

  it('attaches to the composer card: one shared 1px edge, only the dock\'s top corners rounded (council round 8 C3)', () => {
    const last = rule(`${DESK}:last-child`)
    // The dock's bottom edge meets the card's top, where the card's 1px ring is the one line between them.
    expect(last).toMatch(/margin-bottom: calc\(-1 \* var\(--dsh-composer-stack-gap\) - 1px\);/)
    expect(last).toMatch(/border-bottom-width: 0;/)
    expect(last).toMatch(/border-radius: var\(--dsw-radius-lg\) var\(--dsw-radius-lg\) 0 0;/)
    const card = rule(
      `:global(html:not([data-shell-phone-nav])) .composerStack:has(> ${DOCK} > :global([data-dshfiles-live-preview-dock]):last-child) :global([data-composer-card])`,
    )
    expect(card).toMatch(/border-top-left-radius: 0;/)
    expect(card).toMatch(/border-top-right-radius: 0;/)
    expect(rule(`${DESK} > :is(:global([data-dshfiles-live-preview]), :global([data-dshfiles-live-preview-fold]))`)).toMatch(
      /background: var\(--dsw-specific-input-major\);/,
    )
  })
})

describe('the new-thread hero centre (round six C5)', () => {
  it('centres the heading and composer on the whole pane, not on the pane under the blank header', () => {
    // At 1440x900 the pair sat 366px under the tab strip and 329px over the status bar: it was centred in the scroll
    // body, under the blank 36px header row, so the pane read bottom-heavy. Half the header's height goes back. The rule
    // keys on the main body: under Workbench the content is not inside the `.root` that holds the header.
    const rule = blocks().find(block => block.selector === ".body:not(.embeddedBody)[data-content-phase='hero'] .composerHero")
    expect(rule?.context).toBe('@media (min-height: 800px) and (min-width: 640px)')
    // Council round 8 C6: in the rendered 1440x900 capture a 36px foot left 303px of pane above the block's ink and 307px
    // below it; 32px gives both the same.
    expect(rule?.body).toMatch(/padding-bottom: 32px;/)
    expect(css).not.toContain('.root:has(.headerBlank)')
  })
})

describe('the phone transcript fade above the dock (council round 7 C3, round 8 C5, round 10 C1, round 17 C4)', () => {
  it('fades only the last 8px above the Live work card, opaque exactly where the dock surface starts', () => {
    const rule = blocks().find(
      block =>
        block.selector === ":global(html[data-shell-phone-nav]) .body[data-content-phase='active'] .composerSeat" &&
        block.context.startsWith('@media (max-width: 639.98px)'),
    )
    // Council round 17 C4 (Astra): the 28px band greyed a whole line of prose over the dock; the fade is the last 8px.
    expect(rule?.body).toMatch(/padding-top: 8px;/)
    expect(rule?.body).not.toMatch(/padding-top: 28px;/)
    // The last stop is the seat's padding edge, the Live work card's top: the band never ends early or late.
    expect(rule?.body).toMatch(/color-mix\(in srgb, var\(--dsw-alias-bg-base\) 0%, transparent\) 0px,\s*var\(--dsw-alias-bg-base\) 8px\s*\)/)
    for (const longer of ['36px', '28px', '21px', '14px']) expect(rule?.body).not.toContain(longer)
  })
})

describe('one row grammar in the desktop dock (council round 8 C3)', () => {
  const DESK = `:global(html:not([data-shell-phone-nav])) .composerStack > ${DOCK} > :global([data-dshfiles-live-preview-dock])`
  const ROW = `${DESK} :global([data-slot='composer-row']) > :global(div:first-child)`
  const rule = (selector: string): string => blocks().find(candidate => candidate.selector === selector && candidate.context === '')?.body ?? ''

  it('leads a job row with the subagent row\'s chevron seat: 8px inset, 14px chevron, 6px gap, both glyphs 28px in', () => {
    expect(rule(ROW)).toMatch(/padding-inline: 8px 4px;/)
    expect(rule(`${ROW} > :global(button)`)).toMatch(/gap: 6px;/)
    const chevron = rule(`${ROW} > :global(button)::before`)
    expect(chevron).toMatch(/width: 14px;/)
    expect(chevron).toMatch(/height: 14px;/)
    expect(chevron).toMatch(/background: var\(--dsw-alias-label-secondary\);/)
    expect(chevron).toContain("d='m9 18 6-6-6-6'")
    expect(rule(`${DESK} :global([data-slot='composer-row'][data-expanded]) > :global(div:first-child) > :global(button)::before`)).toMatch(/rotate: 90deg;/)
    // Its own trailing chevron goes: one chevron per row.
    expect(rule(`${DESK} :global([data-slot='composer-row-meta']) > :global(svg:last-child)`)).toMatch(/display: none;/)
    // The 18px leading margin of round 7 is gone: the chevron holds the seat.
    expect(css).not.toMatch(/margin-inline-start: 18px;/)
  })

  it('sets both rows at 13px, labels at 500', () => {
    const text = rule(
      `${DESK} :is(:global([data-slot='composer-row-label']), :global([data-slot='composer-row-meta']), :global([data-dshfiles-live-preview='agent']))`,
    )
    expect(text).toMatch(/font-size: 13px;/)
    expect(text).toMatch(/line-height: 16px;/)
    expect(rule(`${DESK} :global([data-slot='composer-row-label'])`)).toMatch(/font-weight: 500;/)
  })
})
