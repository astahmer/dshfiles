import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))
const verbs = row.slice(row.indexOf('const verbButtons = '), row.indexOf('const headVerbs = '))

describe('the phone Inbox head (council round 9 C1)', () => {
  it('gives every card the same two-line head: glyph · full title · seat, then mark · kind · age at 13/400', () => {
    // One head for a bodied card and a bodyless Failed card alike: no one-line head, no compact-only seat.
    expect(row).toContain('InboxView.HEAD_TWO_LINES')
    expect(row).not.toContain('HEAD_ONE_LINE')
    expect(row).not.toContain('HEAD_META_UNDER')
    expect(row).not.toContain('COMPACT_SEAT')
    expect(InboxView.HEAD_TWO_LINES).not.toContain('truncate')
    // Council round 15 C1: on every width, a desktop head too.
    expect(InboxView.HEAD_TWO_LINES).toContain('dshx:[&_[data-slot=entity-row-meta]]:basis-full')
    // The kit's meta step (text-xs) is 13px on a touch screen: no larger step.
    expect(InboxView.HEAD_TWO_LINES).not.toContain('text-sm')
    expect(InboxView.HEAD_TWO_LINES).toContain('dshx:@max-pane-narrow:[&_[data-slot=entity-row-meta]]:leading-4.5')
    // Council round 14 C1: the project's name shows on a phone too (AttentionMeta drops it only when out of room).
    expect(InboxView.HEAD_TWO_LINES).not.toContain('data-inbox-project-name')
    // Line 2 never opens on a separator.
    expect(InboxView.HEAD_TWO_LINES).toContain('[&_[data-slot=entity-row-meta]>[data-inbox-head-part]:first-child>[data-inbox-head-sep]]:hidden')
    // The seat is top-aligned with the title's first line.
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:items-start')
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&_[data-slot=entity-row-trailing]]:self-start')
  })

  it('puts the ⋯ seat 8px inside the card edge on every card, so its glyph sits 22px from it', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:pr-2')
    expect(InboxView.CARD_HEAD).not.toContain('dshx:@max-pane-narrow:[&>div:first-child]:px-4')
  })

  // Council round 16 C3: the command sits in the kit evidence well (inbox-round16.test.ts).
  it('draws an approval command in the evidence well, clamped to four lines in the list', () => {
    expect(row).toContain('<code className={InboxView.WELL_CODE}>')
    expect(InboxView.WELL_CLAMP_RUNS).toBe('dshx:line-clamp-4')
  })
})

describe('the Failed card (council round 9 C3)', () => {
  it('names its kind "Turn failed" in the head, where a finished turn names none', () => {
    expect(InboxView.headMeta('thread-sidebar.finished-turn', 'web-app', true)).toEqual({ project: 'web-app', kind: 'Turn failed' })
    expect(InboxView.headMeta('thread-sidebar.finished-turn', 'web-app')).toEqual({ project: 'web-app', kind: undefined })
    expect(row).toContain("InboxView.headMeta(item.source, project, status === 'failed')")
  })

  it('reads "Review" (named "Review thread") on the red head in the band tint (council round 12 C2)', () => {
    // Council round 12 C2: the band tint, the same trigger as the approval's Review (inbox-round12.test.ts).
    expect(InboxView.headVariant('failed')).toBe('danger-tint')
    expect(InboxView.headVariant('needs-you')).toBe('attention')
    expect(verbs).toContain("place === 'head' ? InboxView.headVariant(status) : InboxView.attentionVariant(status)")
    // The short name shows on every width now; the long one is the accessible name.
    expect(verbs).toContain('aria-label={openLabel}')
    expect(verbs).toContain('{shortLabel ?? openLabel}')
    expect(verbs).not.toContain('dshx:@max-pane-narrow:inline')
  })
})

// Council round 11 C1 moved Triage to a worded button in the top bar (inbox-round11.test.ts).

describe('the phone Inbox gutter (council round 9, lane B B4)', () => {
  it('sets a card glyph and its body text at 24px: the 12px card edge, its 1px border and 11px', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:pl-[11px]')
    expect(InboxView.BODY_INSET).toContain('dshx:@max-pane-narrow:px-[11px]')
    expect(InboxView.BODY_INSET).not.toContain('px-4')
  })
})
