import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const list = panel.slice(panel.indexOf('const triageable = '))

describe('the phone Triage button (council round 10 C2)', () => {
  it('is a framed 44px button with the list-checks glyph before its word, not bare text', () => {
    const at = list.indexOf('data-inbox-phone-triage=""')
    const button = list.slice(list.lastIndexOf('<Button', at), list.indexOf('</Button>', at))
    expect(button).toContain('variant="outline"')
    expect(button).toMatch(/data-inbox-phone-triage="">\s*<ListChecksIcon aria-hidden \/>\s*\{t\('triage'\)\}/u)
    expect(InboxView.PHONE_TRIAGE).toContain('dshx:h-11')
    expect(InboxView.PHONE_TRIAGE).not.toContain('dshx:text-foreground')
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
