import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))
const between = (from: string, to: string): string => row.slice(row.indexOf(from), row.indexOf(to, row.indexOf(from)))

describe('a phone Inbox card (round six C1)', () => {
  it('pads the head row 12px by 16px and gives the title its own line, not a 44pt band around the verb', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-3')
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:px-4')
    expect(InboxView.CARD_HEAD).not.toContain('py-0')
    expect(InboxView.CARD_HEAD).not.toContain('min-h-11')
    // The 44pt ⋯ (and a compact card's verb) sits inside the 12px padding, so the head stays 44px tall.
    expect(InboxView.HEAD_SEAT).toContain('dshx:@max-pane-narrow:-my-3!')
  })

  it('moves the verb of a card with a body to a full-width button at the bottom of the body (36px since council round 7 C2)', () => {
    expect(InboxView.footsVerbs(false)).toBe(true)
    expect(InboxView.FOOT_VERBS).toContain('dshx:hidden')
    expect(InboxView.FOOT_VERBS).toContain('dshx:@max-pane-narrow:flex')
    expect(InboxView.FOOT_VERBS).toContain('dshx:px-4')
    expect(InboxView.FOOT_VERBS).toContain('dshx:pb-2')
    expect(InboxView.FOOT_VERB).toContain('dshx:w-full')
    expect(InboxView.FOOT_VERB).toContain('dshx:h-9!')
    // The head keeps the verbs on a wide pane and only the menu on a compact one.
    expect(InboxView.HEAD_VERBS_WIDE).toContain('dshx:@max-pane-narrow:hidden')
    const foot = between('data-inbox-row-actions="foot"', '</div>')
    expect(foot).toContain("verbButtons('foot')")
    expect(row).toContain("verbButtons('head')")
  })

  it('keeps a bodyless Failed card one row, its verb shortened on a phone and its full name kept for assistive tech', () => {
    expect(InboxView.footsVerbs(true)).toBe(false)
    expect(InboxView.shortOpenLabelKey('review')).toBe('review')
    expect(InboxView.shortOpenLabelKey('approval')).toBe('review')
    expect(InboxView.shortOpenLabelKey('thread')).toBe('open')
    const open = between('{openable && !answerable ? (', '</Button>')
    expect(open).toContain('aria-label={openLabel}')
    expect(open).toContain('dshx:@max-pane-narrow:hidden')
    expect(open).toContain('shortLabel !== null && InboxView.SHORT_VERB')
    expect(InboxView.SHORT_VERB).toBe('dshx:@max-pane-narrow:px-2.5!')
    // Its verb and menu keep to the title line, top-aligned; the age wraps under the title.
    expect(InboxView.COMPACT_SEAT).toContain('dshx:@max-pane-narrow:[&_[data-slot=entity-row-trailing]]:self-start')
    expect(InboxView.COMPACT_SEAT).toContain('dshx:@max-pane-narrow:[&_[data-inbox-row-actions=band]]:gap-0')
    expect(row).toContain('!footed && InboxView.COMPACT_SEAT')
  })

  it('stacks phone cards 8px apart (16px on a wide pane) and drops the padding under a 44pt "Write your own…"', () => {
    const stack = /const INBOX_STACK = '([^']*)'/u.exec(panel)?.[1] ?? ''
    expect(stack).toContain('dshx:gap-4')
    expect(stack).toContain('dshx:@max-pane-narrow:gap-2')
    expect(between('const answers = ', 'const row = ')).toContain("openable && 'dshx:@max-pane-narrow:pointer-coarse:pb-0'")
  })
})
