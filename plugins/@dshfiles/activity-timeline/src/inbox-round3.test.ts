import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))
const phoneBar = readFileSync(new URL('./inbox-phone-bar.tsx', import.meta.url), 'utf8')

describe('the Inbox title (round five C3, council round 3)', () => {
  it('counts each status present, ◆2 ✕1, instead of one Needs-you count that hides a failure', () => {
    expect(InboxView.titleCounts({ needsYou: 3, blocking: 2 })).toEqual({ 'needs-you': 2, failed: 1 })
    expect(InboxView.titleCounts({ needsYou: 2, blocking: 2 })).toEqual({ 'needs-you': 2, failed: 0 })
    expect(InboxView.titleCounts({ needsYou: 1, blocking: 0 })).toEqual({ 'needs-you': 0, failed: 1 })
    expect(InboxView.titleCounts(undefined)).toEqual({})
    // The kit Page draws one StatusCount per status present (A5).
    expect(panel).toMatch(/statusCounts=\{InboxView\.titleCounts\(counts\)\}/u)
  })

  it("ends Start triage and the page menu at the list's trailing edge, not the window's", () => {
    // The kit lane width holds header and list in one container, so the actions end on the list's edge (A5).
    expect(panel.match(/width="lane"/gu)?.length).toBeGreaterThanOrEqual(2)
    expect(panel).not.toContain('InboxView.LIST_WIDTH')
  })
})

describe('an Inbox card on a phone (round five C3, council round 3)', () => {
  it('insets the body 11px inside the card border (24px from the screen edge since council round 9), not under the 36px glyph indent', () => {
    expect(InboxView.BODY_INSET).toBe('dshx:pl-9 dshx:@max-pane-narrow:px-[11px]')
    const body = row.slice(row.indexOf('data-inbox-card-evidence'), row.indexOf('data-inbox-card-evidence') + 400)
    const answers = row.slice(row.indexOf('data-inbox-row-actions=""'), row.indexOf('data-inbox-row-actions=""') + 400)
    expect(body).toContain('InboxView.BODY_INSET')
    expect(answers).toContain('InboxView.BODY_INSET')
  })

  it('puts the card menu in the head band', () => {
    // Round five C4 (council round 5): the menu ends the head row's trailing seat instead of being pinned over it.
    const verbs = row.slice(row.indexOf('const headVerbs = '), row.indexOf('const answers = '))
    expect(verbs).toMatch(/aria-label=\{t\('more'\)\}/u)
    // The head is 44pt tall on a phone: 12px padding around the 20px title (round six C1).
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-3')
    expect(row).toContain('InboxView.CARD_HEAD')
  })

  it('wraps a long answer inside its 44pt row instead of truncating it', () => {
    const choice = row.slice(row.indexOf('item.choices.map('), row.indexOf('data-inbox-recommended'))
    expect(choice).toContain('dshx:pointer-coarse:h-auto dshx:pointer-coarse:min-h-11 dshx:pointer-coarse:py-2.5 dshx:pointer-coarse:whitespace-normal')
    expect(choice).toContain('dshx:pointer-coarse:whitespace-normal dshx:pointer-coarse:text-left')
  })

  it("carries the frame's status button in the phone top bar (round five C2)", () => {
    expect(phoneBar).toMatch(/const status = useContract\(PhoneStatus\)/u)
  })

  it('leaves the centred title clear: the status button takes the leading seat (council round 5)', () => {
    // Status, ⋯ and Start triage together ran over the centred "Inbox" title at 390 px.
    expect(phoneBar).toMatch(/status\.status === 'active' \? \(\s*<div data-inbox-phone-bar="leading"/u)
  })
})
