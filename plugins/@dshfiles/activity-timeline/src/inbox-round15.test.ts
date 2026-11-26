import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')

describe('the desktop Inbox (council round 15 C1)', () => {
  it('draws no tally beside the page title; the Needs you tab keeps it', () => {
    const page = panel.slice(panel.indexOf("mark={<InboxIcon />}\n      markTone=\"inbox\"\n      heading={t('title')}"))
    expect(page.slice(0, page.indexOf('className='))).not.toContain('statusCounts=')
    expect(panel).toContain("statusCounts: InboxView.titleCounts(counts)")
  })

  it('puts the card meta on its own line under the title on every width, with no "·" before the mark', () => {
    expect(InboxView.HEAD_TWO_LINES).toContain('dshx:[&_[data-slot=entity-row-meta]]:basis-full')
    expect(InboxView.HEAD_TWO_LINES).not.toContain('dshx:@max-pane-narrow:[&_[data-slot=entity-row-meta]]:basis-full')
    expect(InboxView.HEAD_TWO_LINES).toContain('dshx:[&_span:has(>[data-slot=entity-row-title])]:gap-y-0.5')
    expect(InboxView.HEAD_TWO_LINES).toContain('dshx:[&_[data-slot=entity-row-meta]>[data-inbox-head-part]:first-child>[data-inbox-head-sep]]:hidden')
    // 6px above and below the two lines, the seat centred on both.
    expect(InboxView.CARD_HEAD).toContain('dshx:[&>div:first-child]:py-1.5')
    expect(InboxView.CARD_HEAD).toContain('dshx:[&_[data-slot=entity-row-trailing]]:self-center')
  })

  it('draws "Open thread" as the same band-tinted pill as Review', () => {
    const at = panel.indexOf('data-inbox-open-head=""')
    expect(at).toBeGreaterThan(-1)
    const button = panel.slice(panel.lastIndexOf('<Button', at), panel.indexOf('</Button>', at))
    expect(button).toContain('variant={InboxView.headVariant(status)}')
    expect(button).toContain('band={InboxView.onBand(status)}')
    for (const quiet of ['variant="ghost"', 'text-muted-foreground', 'ArrowRightIcon']) expect(button).not.toContain(quiet)
    expect(button).toContain('{openLabel}')
  })
})
