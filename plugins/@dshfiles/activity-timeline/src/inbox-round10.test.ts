import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const list = panel.slice(panel.indexOf('const triageable = '))

describe('the phone Triage button (council round 10 C2)', () => {
  it('is a framed 44px square with the list-checks glyph, named "Triage", not bare text', () => {
    const at = list.indexOf('data-inbox-phone-triage=""')
    const button = list.slice(list.lastIndexOf('<Button', at), list.indexOf('</Button>', at))
    expect(button).toContain('variant="outline"')
    expect(button).toContain("aria-label={t('triage')}")
    expect(button).toMatch(/data-inbox-phone-triage="">\s*<ListChecksIcon aria-hidden \/>\s*$/u)
    expect(InboxView.PHONE_TRIAGE).toContain('dshx:h-11 dshx:w-11')
    expect(InboxView.PHONE_TRIAGE).not.toContain('dshx:px-3')
    // A pointer that can hover gets its name as a tooltip.
    expect(list.slice(at)).toMatch(/<\/TooltipTrigger>\s*<TooltipContent>\{t\('triage'\)\}<\/TooltipContent>/u)
  })

  it('keeps the segments clear of it: the strip ends 8px before the 44px square (the tally made the segments wider)', () => {
    expect(list).toContain("triageable && 'dshx:in-data-shell-phone-nav:[&_[data-slot=page-tab-strip]]:pr-13'")
  })
})

describe('the phone "Needs you" segment (council round 10 C2)', () => {
  it('hands the kit its statuses, so a failure below the fold shows as a tally (◆ 2 · ✕ 1) at first glance', () => {
    const tabs = panel.slice(panel.indexOf('const tabs: readonly'), panel.indexOf('const visibleTabs'))
    expect(tabs).toMatch(/view: 'needs-you', label: t\('needsYou'\), count: counts\?\.needsYou \?\? 0, statusCounts: InboxView\.titleCounts\(counts\)/u)
    // The kit reads it from the tab items the page passes.
    expect(list).toContain('...(tab.statusCounts !== undefined && { statusCounts: tab.statusCounts })')
  })
})

describe('the phone Inbox card (council round 10 C2)', () => {
  it('pads its head 8px tighter (8px above and below, not 12) and keeps the 44pt seat inside that padding', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-2')
    expect(InboxView.CARD_HEAD).not.toContain('[&>div:first-child]:py-3')
    expect(InboxView.HEAD_SEAT).toContain('dshx:@max-pane-narrow:-my-2!')
    expect(InboxView.HEAD_SEAT).not.toContain('-my-3!')
  })
})
