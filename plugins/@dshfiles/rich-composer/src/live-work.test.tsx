// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { workCountLabel } from '@dshfiles/plugin-ui/lib/work-count'
import { LiveWork, LiveWorkSummary, PhoneDockHead, useLiveWorkCounts } from './live-work.tsx'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/skeleton/ConversationRoot.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const DOCK = ":global([data-slot='conversation.input.dock'])"

/** The body of every rule inside `@media (max-width: 27.99rem)`, keyed by selector. */
const narrowRules = (): Map<string, string> => {
  const start = css.indexOf('@media (max-width: 27.99rem)')
  const rules = new Map<string, string>()
  if (start < 0) return rules
  let depth = 0
  let end = start
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) {
      end = index
      break
    }
  }
  const block = css.slice(css.indexOf('{', start) + 1, end)
  for (const match of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.set((match[1] ?? '').trim(), match[2] ?? '')
  return rules
}

const jobRow = '<section data-dshfiles-live-preview="job" data-dshfiles-live-preview-seat="dock"></section>'
const agentRow = '<section data-dshfiles-live-preview="agent" data-dshfiles-live-preview-seat="dock"></section>'
const markup = (inner: string): HTMLElement => {
  const dock = document.createElement('div')
  dock.setAttribute('data-slot', 'conversation.input.dock')
  dock.innerHTML = inner
  return dock
}
const english = (key: string, params: { readonly count: number }): string =>
  ({
    'liveWork.job': '{count} job',
    'liveWork.jobs': '{count} jobs',
    'liveWork.subagent': '{count} subagent',
    'liveWork.subagents': '{count} subagents',
    'liveWork.working': '{count} working',
    'liveWork.failed': '{count} failed',
  })[key]!.replace(
    '{count}',
    String(params.count),
  )

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Live work on a narrow phone (unslop r5 C1)', () => {
  it('counts the rows the job and subagent docks render, and a closed fold by its stated count', () => {
    const dock = markup(
      `<div data-dshfiles-live-preview-dock="jobs">${jobRow}</div><div data-dshfiles-live-preview-dock="subagents">${agentRow}</div>`,
    )
    expect(LiveWork.count(dock)).toEqual({ jobs: 1, subagents: 1 })
    const folded = markup(
      '<div data-dshfiles-live-preview-dock="jobs"><button data-dshfiles-live-preview-fold="jobs"><svg></svg><span>3 running</span><span>4m 02s</span></button></div>',
    )
    expect(LiveWork.count(folded)).toEqual({ jobs: 3, subagents: 0 })
    expect(LiveWork.count(markup('<div data-todo=""></div>'))).toEqual({ jobs: 0, subagents: 0 })
  })

  it('says "1 job · 1 subagent" beside running jobs, plural where it counts more, and drops a zero part (council round 23, item 10)', () => {
    // "1 job · 1 working" read as one job of which one is working; it means one job plus one subagent.
    expect(LiveWork.detail({ jobs: 1, subagents: 1 }, english)).toBe('1 job · 1 subagent')
    expect(LiveWork.detail({ jobs: 2, subagents: 3 }, english)).toBe('2 jobs · 3 subagents')
    expect(LiveWork.detail({ jobs: 2, subagents: 0 }, english)).toBe('2 jobs')
  })

  it('counts subagents with the one formula every child summary uses (council round 22, items 3 and 5)', () => {
    // "Live work · 6 subagents" sat above "6 subagents working"; the header alone now reads "Live work · 6 working".
    expect(LiveWork.detail({ jobs: 0, subagents: 6 }, english)).toBe(workCountLabel({ working: 6 }, { working: n => `${n} working`, failed: n => `${n} failed` }))
    expect(LiveWork.detail({ jobs: 0, subagents: 6 }, english)).toBe('6 working')
  })

  it('counts the outlet live under 28rem and draws one 44px disclosure; nothing without live work', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 27.99rem)', addEventListener: () => undefined, removeEventListener: () => undefined }))
    const host = document.createElement('div')
    document.body.append(host)
    const Stack = () => {
      const ref = useRef<HTMLDivElement>(null)
      const counts = useLiveWorkCounts(ref)
      return (
        <div ref={ref}>
          <LiveWorkSummary counts={counts} open={false} onToggle={() => undefined} label="Live work" detail={LiveWork.detail(counts, english)} />
          <div data-slot="conversation.input.dock" />
        </div>
      )
    }
    const root = createRoot(host)
    await act(async () => root.render(<Stack />))
    expect(host.querySelector('[data-live-work-summary]')).toBeNull()
    await act(async () => {
      host.querySelector("[data-slot='conversation.input.dock']")!.innerHTML =
        `<div data-dshfiles-live-preview-dock="jobs">${jobRow}</div><div data-dshfiles-live-preview-dock="subagents">${agentRow}</div>`
      await Promise.resolve()
    })
    const summary = host.querySelector('[data-live-work-summary]')
    expect(summary?.textContent).toBe('Live work·1 job · 1 subagent')
    expect(summary?.getAttribute('aria-expanded')).toBe('false')
    expect(summary?.className).toContain('dshx:h-11')
    await act(async () => root.unmount())
  })

  it('hides live work behind the closed summary and gives every dock entry the full width below 28rem', () => {
    const rules = narrowRules()
    const phone = ':global(html[data-shell-phone-nav])'
    expect(rules.get(`${phone} .liveWork`)).toMatch(/display:\s*flex/)
    expect(rules.get(`${phone} .composerStack > ${DOCK} > *`)).toMatch(/flex-basis:\s*100%/)
    const closed = `${phone} .composerStack:has(> .dockHead > .liveWork):not([data-live-work-open]) > ${DOCK}`
    expect(rules.get(`${closed} > :global([data-dshfiles-live-preview-dock])`)).toMatch(/display:\s*none/)
    // Outside the narrow phone the summary never shows.
    expect(css).toMatch(/\n\.liveWork \{\s*display: none;\s*\}/)
  })
})

describe('the collapsed Live work row (round five C2, council round 3)', () => {
  // Round five C1 (council round 4): the dock's edge is the seat's 24px fade, so the row draws no hairline of its own
  // (a rule there cut the transcript's last visible line in half).
  it('is a flat 44px disclosure without its own rule, not an outlined card', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () =>
      root.render(<LiveWorkSummary counts={{ jobs: 1, subagents: 1 }} open={false} onToggle={() => undefined} label="Live work" detail="1 job · 1 subagent" />),
    )
    const row = host.querySelector<HTMLButtonElement>('[data-live-work-summary]')
    const classes = row?.className.split(/\s+/u) ?? []
    expect(classes).toContain('dshx:h-11')
    expect(classes).not.toContain('dshx:border-t')
    // Opaque page fill: the row sits over the transcript's scroll range, so text never shows through it.
    expect(classes).toContain('dshx:bg-background')
    for (const card of ['dshx:border', 'dshx:rounded-lg', 'dshx:bg-popover']) expect(classes).not.toContain(card)
    await act(async () => root.unmount())
    host.remove()
  })
})

/** The body of the first rule whose selector is exactly `selector`, inside the media block that starts at `media`. */
const ruleIn = (media: string, selector: string): string => {
  let from = css.indexOf(media)
  while (from >= 0) {
    const open = css.indexOf('{', from)
    let depth = 0
    let end = open
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}') depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
    for (const match of css.slice(open + 1, end).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if ((match[1] ?? '').trim() === selector) return match[2] ?? ''
    }
    from = css.indexOf(media, end)
  }
  return ''
}

describe('the phone dock edge (round five C1, council round 4)', () => {
  const PHONE = '@media (max-width: 639.98px), (pointer: coarse) and (max-height: 500px)'
  const phone = ':global(html[data-shell-phone-nav])'

  it('keeps the seat\'s 8px top band on the phone, opaque under the dock (council round 17 C4)', () => {
    const seat = ruleIn(PHONE, `${phone} .body[data-content-phase='active'] .composerSeat`)
    expect(seat).toMatch(/padding-top:\s*8px/)
    // The band itself is clear: the 16px fade drawn over it and above it (below) is the transcript's one edge.
    expect(seat).toMatch(/transparent 0px,\s*transparent 8px,\s*var\(--dsw-alias-bg-base\) 8px/)
  })

  it('fades the transcript out over 16px above the dock, so no line rests cut by its top edge (council round 22, item 6)', () => {
    // Desktop drew no fade above the dock (the seat's own 36px band sat behind the opaque dock), so a line resting on the
    // dock's top edge ("Answered by …" in 15) was sliced in full ink; the phone's 8px band was shorter than a cap height.
    const band = /\n\.body\[data-content-phase='active'\] \.composerSeat::before \{([^}]*)\}/u.exec(css)?.[1] ?? ''
    expect(band).toMatch(/bottom: calc\(100% - var\(--dsh-composer-seat-fade-inset, 0px\)\);/)
    expect(band).toMatch(/pointer-events: none;/)
    expect(band).toMatch(/linear-gradient\(\s*180deg,\s*color-mix\(in srgb, var\(--dsw-alias-bg-base\) 0%, transparent\) 0px,\s*var\(--dsw-alias-bg-base\) 16px,/)
    // Over the text column only, so the back-to-bottom control in the gutter stays whole.
    expect(band).toMatch(/width: min\(calc\(100% - var\(--dsh-composer-side-clearance, 0px\) \* 2\), var\(--dsh-composer-card-max-width\)\);/)
    // On the phone it ends at the dock, 8px into the seat, under the seat's clear top band.
    expect(ruleIn(PHONE, `${phone} .body[data-content-phase='active'] .composerSeat`)).toMatch(/--dsh-composer-seat-fade-inset: 8px;/)
    // A view's composer overlay sits over the view, not a transcript: no fade there.
    expect(css).toMatch(/\.scrollBody:has\(\[data-conversation-composer-overlay\]\) > \.composerSeat::before \{\s*display: none;\s*\}/)
  })

  it('hides the transcript fully 8px before the desktop dock edge, so nothing rests cut on it (council round 23, item 4)', () => {
    // The 16px fade turned opaque exactly at the dock's top edge: "Answered by USED38" still showed faint, sliced by it.
    const band = /\n\.body\[data-content-phase='active'\] \.composerSeat::before \{([^}]*)\}/u.exec(css)?.[1] ?? ''
    // 16px of fade, then a solid band of --dsh-composer-seat-fade-solid (8px by default) down to the dock's edge.
    expect(band).toMatch(/height: calc\(16px \+ var\(--dsh-composer-seat-fade-solid, 8px\)\);/)
    expect(band).toMatch(/var\(--dsw-alias-bg-base\) 16px,\s*var\(--dsw-alias-bg-base\) 100%/)
    // The phone already ended its fade on the Live work card's top under a clear 8px band (council round 22, item 6).
    expect(ruleIn(PHONE, `${phone} .body[data-content-phase='active'] .composerSeat`)).toMatch(/--dsh-composer-seat-fade-solid: 0px;/)
  })

  it('ends the Live work strip with the jump control after a hairline (council round 8 C4)', () => {
    const seat = ruleIn('@media (max-width: 27.99rem)', `${phone} .dockHead:has(> [data-live-work-summary]) > .jumpSeat::before`)
    expect(seat).toMatch(/width:\s*1px/)
    expect(seat).toMatch(/height:\s*20px/)
    expect(seat).toMatch(/background: var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\)/)
    expect(ruleIn('@media (max-width: 27.99rem)', `${phone} .dockHead:has(> [data-live-work-summary]) > .jumpSeat`)).toMatch(/gap:\s*6px/)
    // Council round 10 C1: the 28px round seat sits 8px inside the strip's end, as Live work's chevron does at its start.
    expect(ruleIn('@media (max-width: 27.99rem)', `${phone} .dockHead:has(> [data-live-work-summary]) > .jumpSeat`)).toMatch(/padding-inline-end:\s*8px/)
  })

  it('gives the jump control a trailing seat in the dock head, beside Live work', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 27.99rem)', addEventListener: () => undefined, removeEventListener: () => undefined }))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () =>
      root.render(<PhoneDockHead className="head" jumpSeatClassName="seat" counts={{ jobs: 1, subagents: 0 }} open={false} onToggle={() => undefined} label="Live work" detail="1 job" />),
    )
    const head = host.querySelector('[data-composer-dock-head]')
    expect(head?.firstElementChild?.hasAttribute('data-live-work-summary')).toBe(true)
    // The seat trails the row, so the control sits in the dock, never over the transcript's prose.
    expect(head?.lastElementChild?.hasAttribute('data-composer-jump-seat')).toBe(true)
    await act(async () => root.unmount())
    host.remove()
  })

  it('renders no dock head on a wider screen, where the control keeps the gutter', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () =>
      root.render(<PhoneDockHead counts={{ jobs: 1, subagents: 0 }} open={false} onToggle={() => undefined} label="Live work" detail="1 job" />),
    )
    expect(host.querySelector('[data-composer-dock-head]')).toBeNull()
    await act(async () => root.unmount())
    host.remove()
  })

  it('folds the head away while it holds neither Live work nor the control', () => {
    const hidden = ruleIn('@media (max-width: 27.99rem)', `${phone} .dockHead:not(:has([data-live-work-summary], [data-composer-jump-seat] > *))`)
    expect(hidden).toMatch(/display:\s*none/)
  })
})

describe('Live work attached to the composer on a phone (council round 9 C4)', () => {
  const NARROW = '@media (max-width: 27.99rem)'
  const phone = ':global(html[data-shell-phone-nav])'
  // Open or closed, with nothing else in the dock between the strip and the card (open: council round 23, item 5).
  const attached = `${phone} .composerStack:not(:has(> ${DOCK} > :not([data-dshfiles-live-preview-dock])))`

  it('draws the strip as the composer card\'s top: its fill and hairline, 1px wider, meeting the card\'s ring', () => {
    const head = ruleIn(NARROW, `${attached} > .dockHead:has(> [data-live-work-summary])`)
    // Council round 11 C4: the nav surface; round 19 C2: the card's field edge on its top and sides.
    expect(head).toMatch(/background: var\(--dshx-surface-nav, /)
    expect(head).toMatch(/border: 1px solid var\(--dshx-field-border, var\(--dsw-alias-border-l3\)\);/)
    expect(head).toMatch(/border-bottom-width: 0;/)
    expect(head).toMatch(/border-radius: var\(--dsw-radius-lg\) var\(--dsw-radius-lg\) 0 0;/)
    expect(head).toMatch(/margin-inline: calc\(var\(--dsh-composer-side-clearance, 0px\) - 1px\);/)
    // The card's 1px ring is the one divider between them.
    expect(head).toMatch(/margin-bottom: calc\(-1 \* var\(--dsh-composer-stack-gap\) - 1px\);/)
  })

  it('lets the row take the shared fill, inset like the desktop dock rows, and squares the card\'s top corners', () => {
    const row = ruleIn(NARROW, `${attached} > .dockHead > [data-live-work-summary]`)
    expect(row).toMatch(/background: transparent;/)
    expect(row).toMatch(/padding-inline: 8px 4px;/)
    const card = ruleIn(NARROW, `${attached}:has(> .dockHead > [data-live-work-summary]) :global([data-composer-card])`)
    expect(card).toMatch(/border-top-left-radius: 0;/)
    expect(card).toMatch(/border-top-right-radius: 0;/)
  })
})

describe('one header for live subagents on a phone (council round 22, item 5)', () => {
  const NARROW = '@media (max-width: 27.99rem)'
  const phone = ':global(html[data-shell-phone-nav])'
  const SUBAGENTS = ":global([data-dshfiles-live-preview-dock='subagents'])"
  const OTHER = ":global([data-dshfiles-live-preview-dock]:not([data-dshfiles-live-preview-dock='subagents']))"

  it('hides the subagent fold row while Live work holds only subagents, so "Live work · 6 working" is the one header', () => {
    const only = ruleIn(NARROW, `${phone} .composerStack > ${DOCK}:not(:has(> ${OTHER})) > ${SUBAGENTS} > :global([data-dshfiles-live-preview-fold])`)
    expect(only).toMatch(/display:\s*none/)
  })

  it('draws the rows as one card with 1px dividers, capped so the list scrolls', () => {
    const card = ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS}`)
    expect(card).toMatch(/border: 1px solid var\(--dshx-field-border, var\(--dsw-alias-border-l3\)\);/)
    expect(card).toMatch(/border-radius: var\(--dsw-radius-lg\);/)
    expect(card).toMatch(/background: var\(--dsw-specific-input-major\);/)
    // thread-sidebar's two-line row is 54px; the cap is council round 23 item 5's (below).
    const row = ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS} > :is(:global([data-dshfiles-live-preview]), :global([data-dshfiles-live-preview-fold]))`)
    for (const flat of [/margin-block: 0;/, /border: 0;/, /border-radius: 0;/]) expect(row).toMatch(flat)
    const divider = ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS} > :global([data-dshfiles-live-preview]) ~ :global([data-dshfiles-live-preview])`)
    expect(divider).toMatch(/border-top: 1px solid var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
  })

  it('makes the sticky fold row an opaque, square, full-width plate with a bottom hairline (17b)', () => {
    // Its 4px margin let row text scroll into view above it, and its own rounded card let row borders show at its corners.
    const plate = ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS} > :global([data-dshfiles-live-preview-fold])`)
    expect(plate).toMatch(/top: 0;/)
    expect(plate).toMatch(/width: 100%;/)
    expect(plate).toMatch(/background: var\(--dsw-specific-input-major\);/)
    expect(plate).toMatch(/box-shadow: 0 1px 0 var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
    // Beside jobs the plate shows: the cap makes room for its 44px.
    const cap = ruleIn(NARROW, `${phone} .composerStack > ${DOCK}:has(> ${OTHER}) > ${SUBAGENTS}`)
    expect(cap).toMatch(/max-height: calc\(44px \+ /)
  })

  it('fades rows out over 16px at a scroll edge that can still scroll, and nowhere else (17b, council round 24 item 4)', () => {
    // Scrolled to its end, the card's top edge sliced the third row's model line in full ink; then an 8px fade sat on
    // both edges at every position, so the top faded at rest and the bottom at the end.
    const edges = ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS}::before,\n  ${phone} .composerStack > ${DOCK} > ${SUBAGENTS}::after`)
    expect(edges).toMatch(/position: sticky;/)
    expect(edges).toMatch(/height: 16px;/)
    expect(edges).toMatch(/pointer-events: none;/)
    expect(edges).toMatch(/opacity: 0;/)
    const top = ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS}::before`)
    expect(top).toMatch(/top: 0;/)
    // No room of its own. Its first 8px hold the fill: at a snap position that is the edge's padding and the next
    // row's divider 7px in, which a plain linear fade left half drawn, a second hairline beside the frame's edge.
    expect(top).toMatch(/margin-bottom: -16px;/)
    expect(top).toMatch(/linear-gradient\(180deg, var\(--dsw-specific-input-major\) 8px, color-mix\(in srgb, var\(--dsw-specific-input-major\) 0%, transparent\)\)/)
    const bottom = ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS}::after`)
    expect(bottom).toMatch(/bottom: 0;/)
    expect(bottom).toMatch(/margin-top: -16px;/)
    expect(bottom).toMatch(/linear-gradient\(0deg, var\(--dsw-specific-input-major\) 8px, color-mix\(in srgb, var\(--dsw-specific-input-major\) 0%, transparent\)\)/)
    // Shown only on an edge thread-sidebar's dock marks as able to scroll.
    expect(ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > :global([data-dshfiles-live-preview-dock='subagents'][data-more-above])::before`)).toMatch(/opacity: 1;/)
    expect(ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > :global([data-dshfiles-live-preview-dock='subagents'][data-more-below])::after`)).toMatch(/opacity: 1;/)
    // Beside running jobs the top fade sits under the 44px fold plate, not behind it.
    expect(ruleIn(NARROW, `${phone} .composerStack > ${DOCK}:has(> ${OTHER}) > ${SUBAGENTS}::before`)).toMatch(/top: 44px;/)
  })

  it('keeps the fold row beside running jobs, and its closed state hides the rows behind it', () => {
    const closed = ruleIn(
      NARROW,
      `${phone} .composerStack > ${DOCK}:has(> ${OTHER}) > ${SUBAGENTS}:has(> :global([data-dshfiles-live-preview-fold][aria-expanded='false'])) > :global([data-dshfiles-live-preview])`,
    )
    expect(closed).toMatch(/display:\s*none/)
  })
})

describe('the phone Live work strip on the nav surface (council round 11 C4)', () => {
  const NARROW = '@media (max-width: 27.99rem)'
  const phone = ':global(html[data-shell-phone-nav])'
  const attached = `${phone} .composerStack:not(:has(> ${DOCK} > :not([data-dshfiles-live-preview-dock])))`

  it('sits on the nav surface above the composer fill, with the field edge and the card ring as its one separator', () => {
    const head = ruleIn(NARROW, `${attached} > .dockHead:has(> [data-live-work-summary])`)
    expect(head).toMatch(/background: var\(--dshx-surface-nav, var\(--dsw-specific-sidebar-fill, var\(--dsw-alias-bg-layer-1\)\)\);/)
    expect(head).not.toMatch(/--dsw-specific-input-major/)
    expect(head).toMatch(/border: 1px solid var\(--dshx-field-border, var\(--dsw-alias-border-l3\)\);/)
    expect(head).toMatch(/border-bottom-width: 0;/)
  })

  it('fills the jump control with the composer fill and a hairline, so it does not vanish into the strip in light', () => {
    const jump = ruleIn(NARROW, `${attached} > .dockHead:has(> [data-live-work-summary]) > .jumpSeat > :global(button)`)
    expect(jump).toMatch(/background: var\(--dsw-specific-input-major\);/)
    expect(jump).toMatch(/box-shadow: inset 0 0 0 1px var\(--dsw-alias-border-l2\);/)
  })
})

describe('the open phone dock is the composer card\'s top section (council round 23, item 5)', () => {
  const NARROW = '@media (max-width: 27.99rem)'
  const phone = ':global(html[data-shell-phone-nav])'
  const SUBAGENTS = ":global([data-dshfiles-live-preview-dock='subagents'])"
  const OTHER = ":global([data-dshfiles-live-preview-dock]:not([data-dshfiles-live-preview-dock='subagents']))"
  const LIVE = ':global([data-dshfiles-live-preview-dock])'
  // Open or closed, with nothing but live work in the dock between the strip and the card.
  const joined = `${phone} .composerStack:not(:has(> ${DOCK} > :not([data-dshfiles-live-preview-dock])))`
  const open = `${phone} .composerStack[data-live-work-open]:not(:has(> ${DOCK} > :not([data-dshfiles-live-preview-dock])))`

  it('keeps the strip framed as the card\'s top while open, its one hairline over the rows, no gap', () => {
    // Open, the strip floated flat on the page above a separate card of rows, 6px from it and 6px from the composer.
    const head = ruleIn(NARROW, `${joined} > .dockHead:has(> [data-live-work-summary])`)
    expect(head).toMatch(/border: 1px solid var\(--dshx-field-border, var\(--dsw-alias-border-l3\)\);/)
    expect(head).toMatch(/border-radius: var\(--dsw-radius-lg\) var\(--dsw-radius-lg\) 0 0;/)
    const openHead = ruleIn(NARROW, `${open} > .dockHead:has(> [data-live-work-summary])`)
    expect(openHead).toMatch(/margin-bottom: calc\(-1 \* var\(--dsh-composer-stack-gap\)\);/)
    expect(openHead).toMatch(/border-bottom: 1px solid var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
    expect(ruleIn(NARROW, `${joined}:has(> .dockHead > [data-live-work-summary]) :global([data-composer-card])`)).toMatch(/border-top-left-radius: 0;/)
  })

  it('runs the rows between the strip and the card on the card\'s side edges, with no frame or gap of their own', () => {
    const outlet = ruleIn(NARROW, `${open} > ${DOCK}`)
    expect(outlet).toMatch(/row-gap: 0;/)
    // The card's 1px ring is the line between the rows and the input: the rows end on its top, never over it.
    expect(outlet).toMatch(/margin-bottom: calc\(1px - var\(--dsh-composer-stack-gap\)\);/)
    const section = ruleIn(NARROW, `${open} > ${DOCK} > ${LIVE}`)
    expect(section).toMatch(/flex-basis: calc\(100% \+ 2px\);/)
    expect(section).toMatch(/margin-inline: -1px;/)
    expect(section).toMatch(/border-block-width: 0;/)
    expect(section).toMatch(/border-radius: 0;/)
    expect(ruleIn(NARROW, `${open} > ${DOCK} > ${LIVE} + ${LIVE}`)).toMatch(/border-top: 1px solid var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
  })

  it('shows two whole rows over the next row\'s padding, snapping to whole rows so a model line never shows without its title', () => {
    // 54px two-line rows: two rows, their divider, then 8px (the next row's divider and padding, or at the end the row
    // above's bottom padding). Council round 24, item 4: the 31px title peek forced a blank half-row at the scroll end.
    expect(ruleIn(NARROW, `${open} > ${DOCK} > ${SUBAGENTS}`)).toMatch(/max-height: calc\(2 \* 54px \+ 1px \+ 8px\);/)
    const card = ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS}`)
    expect(card).toMatch(/max-height: calc\(2 \* 54px \+ 1px \+ 8px \+ 2px\);/)
    expect(card).toMatch(/scroll-snap-type: y mandatory;/)
    expect(ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS} > :global([data-dshfiles-live-preview])`)).toMatch(/scroll-snap-align: start;/)
    // Beside running jobs the sticky 44px fold plate sits over the top: snap below it.
    const beside = ruleIn(NARROW, `${phone} .composerStack > ${DOCK}:has(> ${OTHER}) > ${SUBAGENTS}`)
    expect(beside).toMatch(/max-height: calc\(44px \+ 2 \* 54px \+ 1px \+ 8px \+ 2px\);/)
    expect(beside).toMatch(/scroll-padding-top: 44px;/)
    expect(ruleIn(NARROW, `${open} > ${DOCK}:has(> ${OTHER}) > ${SUBAGENTS}`)).toMatch(/max-height: calc\(44px \+ 2 \* 54px \+ 1px \+ 8px \+ 1px\);/)
    expect(css).not.toMatch(/3\.5 \* 54px/)
  })

  it('grows the frame to the one open row, so its feed and Stop are never cut off (merge 534773f0)', () => {
    // An opened row (54px head, its feed, Open beside and Stop) ran past the two-row frame: "Stop subagent" was cut off.
    // thread-sidebar's dock keeps one row open and sets its height; the frame takes at least that row, plus its own
    // edges and, beside running jobs, the 44px fold plate only while that fold row exists (four or more subagents: one
    // subagent beside a job left a 44px blank under its open row). With no row open it is the closed two-row frame.
    const ROW = 'var(--dshfiles-dock-open-row, 0px)'
    const FOLD = ':has(> :global([data-dshfiles-live-preview-fold]))'
    const minHeight = (rule: string): string | undefined => /min-height: ([^;]*);/u.exec(rule)?.[1]
    expect(minHeight(ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS}`))).toBe(`calc(${ROW} + 2px)`)
    expect(minHeight(ruleIn(NARROW, `${phone} .composerStack > ${DOCK}:has(> ${OTHER}) > ${SUBAGENTS}`))).toBeUndefined()
    expect(minHeight(ruleIn(NARROW, `${phone} .composerStack > ${DOCK}:has(> ${OTHER}) > ${SUBAGENTS}${FOLD}`))).toBe(`calc(44px + ${ROW} + 2px)`)
    expect(minHeight(ruleIn(NARROW, `${open} > ${DOCK} > ${SUBAGENTS}`))).toBe(ROW)
    expect(minHeight(ruleIn(NARROW, `${open} > ${DOCK}:has(> ${OTHER}) > ${SUBAGENTS}`))).toBe(`calc(${ROW} + 1px)`)
    expect(minHeight(ruleIn(NARROW, `${open} > ${DOCK}:has(> ${OTHER}) > ${SUBAGENTS}${FOLD}`))).toBe(`calc(44px + ${ROW} + 1px)`)
  })

  it('rests the last row on the frame\'s bottom edge at the scroll end, and no snap position cuts a row\'s text (council round 24, item 4)', () => {
    // The last row carried a 30px spacer, so the end position showed a blank half-row under it (17b).
    expect(css).not.toMatch(/nth-of-type\(n \+ 3\):last-of-type/)
    const last = ruleIn(NARROW, `${phone} .composerStack > ${DOCK} > ${SUBAGENTS} > :global(section[data-dshfiles-live-preview]:last-of-type)`)
    expect(last).toMatch(/scroll-snap-align: end;/)
    // Lay the open frame out: a row is 8px padding, a 20px title, a 2px gap, a 16px model line and 8px padding; every
    // row after the first adds its 1px divider on top.
    const frame = /max-height: calc\(([^;]*)\);/u.exec(ruleIn(NARROW, `${open} > ${DOCK} > ${SUBAGENTS}`))?.[1] ?? ''
    const height = frame.split('+').reduce((sum, term) => sum + term.split('*').reduce((product, factor) => product * Number.parseFloat(factor), 1), 0)
    expect(height).toBe(117)
    for (const count of [3, 4, 6]) {
      const rows = Array.from({ length: count }, (_, index) => {
        const start = index === 0 ? 0 : 54 + (index - 1) * 55
        const top = index === 0 ? start : start + 1
        return { start, title: [top + 8, top + 28] as const, model: [top + 30, top + 46] as const, end: top + 54 }
      })
      const max = rows.at(-1)!.end - height
      // Each row's start, clamped into the range, and the range's end (the last row's `end` snap).
      const positions = [...new Set([...rows.map(row => Math.min(row.start, max)), max])]
      for (const scroll of positions) {
        const [from, to] = [scroll, scroll + height]
        for (const row of rows) {
          const shows = (line: readonly [number, number]): boolean => line[0] < to && line[1] > from
          const whole = (line: readonly [number, number]): boolean => line[0] >= from && line[1] <= to
          // No line of text is cut by an edge, and no model line shows without its title.
          for (const line of [row.title, row.model]) if (shows(line)) expect(whole(line), `${count} rows at ${scroll}px`).toBe(true)
          if (shows(row.model)) expect(shows(row.title), `${count} rows at ${scroll}px`).toBe(true)
        }
      }
      // At the end the last row's bottom is the frame's bottom: no blank under it.
      expect(rows.at(-1)!.end - max).toBe(height)
    }
  })
})
