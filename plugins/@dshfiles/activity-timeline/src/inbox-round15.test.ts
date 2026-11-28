import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const locales = readFileSync(new URL('./inbox-locales.ts', import.meta.url), 'utf8')

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

  // Council round 16 C2 makes "Open thread" a quiet ghost again, with ↗ (inbox-round16.test.ts).
  it('reads "Open thread" in words', () => {
    const at = panel.indexOf('data-inbox-open-head=""')
    expect(at).toBeGreaterThan(-1)
    const button = panel.slice(panel.lastIndexOf('<Button', at), panel.indexOf('</Button>', at))
    expect(button).toContain('{openLabel}')
  })
})

describe('the failed card\'s reason well (council round 15 C2)', () => {
  const failed = (reason: string, detail: string | null = null) => ({ source: 'thread-sidebar.finished-turn', severity: 'failed' as const, reason, detail })

  it('reads a provider error\'s first line', () => {
    expect(InboxView.failureWell(failed('“Upgrade the router to v8” failed', '\n  The model provider is overloaded (HTTP 529).\n  at stack'))).toEqual({
      kind: 'error',
      line: 'The model provider is overloaded (HTTP 529).',
    })
  })

  it('otherwise names the failure in plain words', () => {
    expect(InboxView.failureWell(failed('“Upgrade the router to v8” failed'))).toEqual({ kind: 'stopped-on-error' })
    expect(InboxView.failureWell(failed('Turn failed.'))).toEqual({ kind: 'stopped-on-error' })
    expect(InboxView.failureWell(failed('“Upgrade the router to v8” stopped at the output token limit'))).toEqual({ kind: 'token-limit' })
    expect(InboxView.failureWell(failed('Turn stopped at the output token limit.'))).toEqual({ kind: 'token-limit' })
    // Council round 16 C3: "Error:" is the well's label; a plain error draws no well, so it has no sentence.
    expect(locales).toContain("failedErrorLabel: 'Error:',")
    expect(locales).not.toContain('failedOnError')
    expect(locales).toContain("failedTokenLimit: 'The turn hit the output token limit.',")
  })

  it('draws no well when nothing is known, nor on another kind of item', () => {
    expect(InboxView.failureWell(failed('“Upgrade the router to v8” paused'))).toBeNull()
    expect(InboxView.failureWell({ ...failed('“Fix auth” finished · ready to review'), severity: 'ready' })).toBeNull()
    expect(InboxView.failureWell({ ...failed('Push failed', 'rejected'), source: 'jj-integration.land' })).toBeNull()
  })

  // Council round 16 C3: the kit's danger evidence well (inbox-round16.test.ts).
  it('marks its kind on the well', () => {
    expect(panel).toContain('data-inbox-failure-well={failure.kind}')
  })

  it('keeps the card compact, so a phone keeps its 46pt head Review (the 390×664 fold has no room for a footer)', () => {
    expect(panel).toMatch(/failure === null\s*\?\s*InboxView\.cardText\([^]*?: \{ reason: null, detail: null, command: false \}/u)
    expect(InboxView.compact('failed', { reason: null, detail: null })).toBe(true)
    expect(InboxView.footsVerbs({ compact: true, coarse: true, verbs: 1, answers: false })).toBe(false)
  })
})
