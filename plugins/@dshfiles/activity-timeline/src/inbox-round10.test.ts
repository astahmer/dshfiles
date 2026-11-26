import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const list = panel.slice(panel.indexOf('const triageable = '))

// Council round 11 C1 moved Triage to a worded button in the top bar (inbox-round11.test.ts).

describe('the phone "Needs you" segment (council round 10 C2)', () => {
  it('hands the kit its statuses, so a failure below the fold shows as a tally (◆ 2 · ✕ 1) at first glance', () => {
    const tabs = panel.slice(panel.indexOf('const tabs: readonly'), panel.indexOf('const visibleTabs'))
    expect(tabs).toMatch(/view: 'needs-you', label: t\('needsYou'\), count: counts\?\.needsYou \?\? 0, statusCounts: InboxView\.titleCounts\(counts\)/u)
    // The kit reads it from the tab items the page passes.
    expect(list).toContain('...(tab.statusCounts !== undefined && { statusCounts: tab.statusCounts })')
  })
})

describe('the phone Inbox card (council round 10 C2)', () => {
  it('pads its head 8px tighter (8px above and below, not 12; 6px since council round 12 C3) and keeps the 44pt seat inside that padding', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-1.5')
    expect(InboxView.CARD_HEAD).not.toContain('[&>div:first-child]:py-3')
    expect(InboxView.HEAD_SEAT).toContain('dshx:@max-pane-narrow:-my-2!')
    expect(InboxView.HEAD_SEAT).not.toContain('-my-3!')
  })
})
