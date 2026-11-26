// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  ({ 'liveWork.job': '{count} job', 'liveWork.jobs': '{count} jobs', 'liveWork.subagent': '{count} subagent', 'liveWork.subagents': '{count} subagents' })[key]!.replace(
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

  it('says "1 job · 1 subagent", plural where it counts more, and drops a zero part', () => {
    expect(LiveWork.detail({ jobs: 1, subagents: 1 }, english)).toBe('1 job · 1 subagent')
    expect(LiveWork.detail({ jobs: 2, subagents: 0 }, english)).toBe('2 jobs')
    expect(LiveWork.detail({ jobs: 0, subagents: 4 }, english)).toBe('4 subagents')
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

  it('ends the transcript above the dock in a 16px fade (council round 8 C5), so no line of text is cut by a rule', () => {
    const seat = ruleIn(PHONE, `${phone} .body[data-content-phase='active'] .composerSeat`)
    expect(seat).toMatch(/padding-top:\s*16px/)
    // Transparent at the band's top, the page base before the band ends: the band is the fade, the dock below opaque.
    expect(seat).toMatch(/var\(--dsw-alias-bg-base\) 0%, transparent\) 0px,/)
    const opaqueAt = Number(/var\(--dsw-alias-bg-base\) (\d+)px\s*\)/u.exec(seat)?.[1])
    expect(opaqueAt).toBeGreaterThan(0)
    expect(opaqueAt).toBeLessThanOrEqual(16)
  })

  it('ends the Live work strip with the jump control after a hairline (council round 8 C4)', () => {
    const seat = ruleIn('@media (max-width: 27.99rem)', `${phone} .dockHead:has(> [data-live-work-summary]) > .jumpSeat::before`)
    expect(seat).toMatch(/width:\s*1px/)
    expect(seat).toMatch(/height:\s*20px/)
    expect(seat).toMatch(/background: var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\)/)
    expect(ruleIn('@media (max-width: 27.99rem)', `${phone} .dockHead:has(> [data-live-work-summary]) > .jumpSeat`)).toMatch(/gap:\s*6px/)
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
  // Closed, with nothing else in the dock between the strip and the card.
  const attached = `${phone} .composerStack:not([data-live-work-open]):not(:has(> ${DOCK} > :not([data-dshfiles-live-preview-dock])))`

  it('draws the strip as the composer card\'s top: its fill and hairline, 1px wider, meeting the card\'s ring', () => {
    const head = ruleIn(NARROW, `${attached} > .dockHead:has(> [data-live-work-summary])`)
    expect(head).toMatch(/background: var\(--dsw-specific-input-major\);/)
    expect(head).toMatch(/border: 1px solid var\(--dshx-tone-line, var\(--dsw-alias-border-l2\)\);/)
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
