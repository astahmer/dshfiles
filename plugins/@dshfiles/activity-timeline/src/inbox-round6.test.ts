import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))
const between = (from: string, to: string): string => row.slice(row.indexOf(from), row.indexOf(to, row.indexOf(from)))

describe('a phone Inbox card (round six C1)', () => {
  it('pads the head row 12px (11px before the glyph, 8px after the seat) and gives the title its own line', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-1.5')
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:pl-[11px]')
    expect(InboxView.CARD_HEAD).not.toContain('py-0')
    expect(InboxView.CARD_HEAD).not.toContain('min-h-11')
    // The 44pt ⋯ (and a compact card's verb) sits inside the 12px padding, centred on the title's first line.
    expect(InboxView.HEAD_SEAT).toContain('dshx:@max-pane-narrow:-my-2!')
  })

  it('moves the verb of a card with a body to a full-width button at the bottom of the body (36px since council round 7 C2)', () => {
    expect(InboxView.footsVerbs(false, true)).toBe(true)
    // Council round 8 C2: the verbs follow the evidence in the body on every width, full-width under it on a phone.
    expect(InboxView.BODY_VERBS).toContain('dshx:@max-pane-narrow:flex-col')
    expect(InboxView.FOOT_VERB).toContain('dshx:@max-pane-narrow:w-full')
    expect(InboxView.FOOT_VERB).toContain('dshx:@max-pane-narrow:h-9!')
    const body = between('data-inbox-row-actions="body"', '</div>')
    expect(body).toContain("verbButtons('body')")
    expect(row).toContain("verbButtons('head')")
  })

  it('keeps a bodyless Failed card one row, its verb shortened and its full name kept for assistive tech', () => {
    expect(InboxView.footsVerbs(true, true)).toBe(false)
    expect(InboxView.shortOpenLabelKey('review')).toBe('review')
    expect(InboxView.shortOpenLabelKey('approval')).toBe('review')
    expect(InboxView.shortOpenLabelKey('thread')).toBe('open')
    const open = between('{openable && !answerable ? (', '</Button>')
    expect(open).toContain('aria-label={openLabel}')
    expect(open).toContain('{shortLabel ?? openLabel}')
    expect(open).toContain('shortLabel !== null && InboxView.SHORT_VERB')
    expect(InboxView.SHORT_VERB).toBe('dshx:@max-pane-narrow:px-2.5!')
    // Its verb and menu keep to the title line, top-aligned; the age wraps under the title (every card, round 9 C1).
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&_[data-slot=entity-row-trailing]]:self-start')
    expect(InboxView.HEAD_TWO_LINES).toContain('dshx:@max-pane-narrow:[&_[data-inbox-row-actions=band]]:gap-0')
  })

  it('stacks phone cards 8px apart (16px on a wide pane) and ends a phone question card 4px under its last answer (council round 12 C3)', () => {
    const stack = /const INBOX_STACK = '([^']*)'/u.exec(panel)?.[1] ?? ''
    expect(stack).toContain('dshx:gap-4')
    expect(stack).toContain('dshx:@max-pane-narrow:gap-2')
    expect(between('const answers = ', 'const row = ')).toContain('InboxView.ANSWERS')
    expect(InboxView.ANSWERS).toContain('dshx:@max-pane-narrow:pb-1')
  })
})
