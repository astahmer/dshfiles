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
    expect(locales).toContain("failedError: 'Error: {line}',")
    expect(locales).toContain("failedOnError: 'The turn stopped on an error.',")
    expect(locales).toContain("failedTokenLimit: 'The turn hit the output token limit.',")
  })

  it('draws no well when nothing is known, nor on another kind of item', () => {
    expect(InboxView.failureWell(failed('“Upgrade the router to v8” paused'))).toBeNull()
    expect(InboxView.failureWell({ ...failed('“Fix auth” finished · ready to review'), severity: 'ready' })).toBeNull()
    expect(InboxView.failureWell({ ...failed('Push failed', 'rejected'), source: 'jj-integration.land' })).toBeNull()
  })

  it('is one line on the failed wash in ink, mono for an error, under the title on every width', () => {
    for (const part of ['dshx:bg-wash-failed', 'dshx:truncate', 'dshx:text-xs', 'dshx:leading-4.5', 'dshx:text-foreground', 'dshx:rounded-md', 'dshx:py-1', 'dshx:px-2.5'])
      expect(InboxView.FAILURE_WELL).toContain(part)
    expect(InboxView.FAILURE_WELL_ERROR).toBe('dshx:font-mono')
    expect(panel).toContain('data-inbox-failure-well={failure.kind}')
  })

  it('keeps the card compact, so a phone keeps its 46pt head Review (the 390×664 fold has no room for a footer)', () => {
    expect(panel).toMatch(/failure === null\s*\?\s*InboxView\.cardText\([^]*?: \{ reason: null, detail: null, command: false \}/u)
    expect(InboxView.compact('failed', { reason: null, detail: null })).toBe(true)
    expect(InboxView.footsVerbs(true, true)).toBe(false)
  })
})
