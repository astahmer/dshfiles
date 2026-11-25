import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))
const phoneBar = readFileSync(new URL('./inbox-phone-bar.tsx', import.meta.url), 'utf8')

describe('the Inbox title (round five C3, council round 3)', () => {
  it('counts each status present, ◆2 ✕1, instead of one Needs-you count that hides a failure', () => {
    expect(InboxView.titleCounts({ needsYou: 3, blocking: 2 })).toEqual([
      { status: 'needs-you', count: 2 },
      { status: 'failed', count: 1 },
    ])
    expect(InboxView.titleCounts({ needsYou: 2, blocking: 2 })).toEqual([{ status: 'needs-you', count: 2 }])
    expect(InboxView.titleCounts({ needsYou: 1, blocking: 0 })).toEqual([{ status: 'failed', count: 1 }])
    expect(InboxView.titleCounts(undefined)).toEqual([])
    expect(panel).toMatch(/InboxView\.titleCounts\(counts\)\.map\(entry => \(\s*<StatusCount/u)
  })

  it("ends Start triage and the page menu at the list's trailing edge, not the window's", () => {
    expect(InboxView.LIST_WIDTH).toBe('dshx:max-w-[880px]')
    expect(InboxView.HEADER_WIDTH).toBe('dshx:[&_[data-slot=page-header]]:max-w-[880px]')
    expect(panel.match(/InboxView\.HEADER_WIDTH/gu)?.length).toBeGreaterThanOrEqual(1)
  })
})

describe('an Inbox card on a phone (round five C3, council round 3)', () => {
  it('insets the body 16px from the card edge, not under the 36px glyph indent', () => {
    expect(InboxView.BODY_INSET).toBe('dshx:pl-9 dshx:@max-pane-narrow:px-4')
    const body = row.slice(row.indexOf('data-inbox-card-body'), row.indexOf('data-inbox-card-body') + 400)
    const actions = row.slice(row.indexOf('data-inbox-row-actions'), row.indexOf('data-inbox-row-actions') + 400)
    expect(body).toContain('InboxView.BODY_INSET')
    expect(actions).toContain('InboxView.BODY_INSET')
  })

  it('puts the card menu in the head band', () => {
    expect(InboxView.BAND_MENU).toBe('dshx:@max-pane-narrow:absolute dshx:@max-pane-narrow:top-0 dshx:@max-pane-narrow:right-1')
    expect(row).toMatch(/aria-label=\{t\('more'\)\}[^>]*\n?[^>]*InboxView\.BAND_MENU|InboxView\.BAND_MENU[^>]*aria-label=\{t\('more'\)\}/u)
    // The head is 44pt tall with room for it, so a long title never runs under the menu.
    expect(InboxView.PHONE_HEAD).toBe('dshx:@max-pane-narrow:[&>div:first-child]:py-3 dshx:@max-pane-narrow:[&>div:first-child]:pr-12')
    expect(row).toContain('InboxView.PHONE_HEAD')
  })

  it('wraps a long answer inside its 44pt row instead of truncating it', () => {
    const choice = row.slice(row.indexOf('item.choices.map('), row.indexOf('data-inbox-recommended'))
    expect(choice).toContain('dshx:pointer-coarse:h-auto dshx:pointer-coarse:min-h-11 dshx:pointer-coarse:py-2.5 dshx:pointer-coarse:whitespace-normal')
    expect(choice).toContain('dshx:pointer-coarse:whitespace-normal dshx:pointer-coarse:text-left')
  })

  it("carries the frame's status button in the phone top bar (round five C2)", () => {
    expect(phoneBar).toMatch(/const status = useContract\(PhoneStatus\)/u)
    expect(phoneBar).toMatch(/status\.status === 'active' \? <status\.value\.Button \/> : null/u)
  })
})
