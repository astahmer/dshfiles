import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))
const phoneBar = readFileSync(new URL('./inbox-phone-bar.tsx', import.meta.url), 'utf8')
const between = (from: string, to: string): string => row.slice(row.indexOf(from), row.indexOf(to, row.indexOf(from)))

describe('an Inbox card (round five C4, council round 5)', () => {
  it('stacks cards 16px apart, the kit page stack, not 8px', () => {
    const stack = /const INBOX_STACK = '([^']*)'/u.exec(panel)?.[1] ?? ''
    expect(stack).toContain('dshx:gap-4')
    expect(stack).not.toContain('dshx:gap-2')
  })

  it('keeps the head row for the menu and a bodyless card verb (council round 8 C2)', () => {
    // Council round 8 C2: a card with a body draws its verbs after its evidence; only a bodyless Failed card keeps them here.
    expect(row).toMatch(/trailing=\{\(props\.actionRow === false && !compact\) \|\| \(footed && !hasMenu\) \? undefined : headVerbs\}/u)
    // Round six C1: one set of verb buttons, drawn in the head (and, on a compact pane, at the foot of a card's body).
    const verbs = between('const verbButtons = ', 'const answers = ')
    expect(verbs).toContain('data-inbox-row-actions="band"')
    expect(verbs).toContain("verbButtons('head')")
    expect(verbs).toContain('PROVIDER_VERBS.filter')
    expect(verbs).toContain('{openLabel}')
    // The menu is the seat's last control, not a box pinned over the band.
    expect(verbs.lastIndexOf('<DropdownMenu>')).toBeGreaterThan(verbs.indexOf('{openLabel}'))
    expect(row).not.toContain('BAND_MENU')
    expect(InboxView).not.toHaveProperty('BAND_MENU')
  })

  it('draws the primary verb 28px tall in the attention tint', () => {
    expect(InboxView.HEAD_VERB).toContain('dshx:h-7')
    const open = between('{openable && !answerable ? (', '{openLabel}')
    expect(open).toContain('InboxView.attentionVariant(status)')
    expect(open).toContain('size')
    expect(between('const verbButtons = ', 'const headVerbs = ')).toContain("place === 'head' ? cn('dshx:shrink', InboxView.HEAD_VERB)")
  })

  it('keeps only content and answers in the body', () => {
    const answers = between('const answers = ', 'const row = ')
    expect(answers).toContain('item.choices.map(')
    expect(answers).toContain('data-inbox-write-own')
    expect(answers).not.toContain('PROVIDER_VERBS')
    expect(answers).not.toContain('<DropdownMenu')
    expect(answers).not.toContain('{openLabel}')
    // Answers sit 8px under the question.
    expect(answers).toContain('InboxView.ANSWERS')
    expect(InboxView.ANSWERS).toContain('dshx:pt-2 dshx:pb-3')
  })

  it('names a finished turn\'s project (its mark and name), not the source\'s "Thread turns"', () => {
    expect(InboxView.namesProject('thread-sidebar.finished-turn')).toBe(true)
    expect(InboxView.namesProject('thread-sidebar.approval')).toBe(false)
    expect(InboxView.namesProject('agent-questions.native-question')).toBe(false)
    expect(row).toMatch(/<ProjectMark name=\{head\.project\} size="dense" \/>/u)
    expect(panel).toContain('EntityLabels.useWorkspaceLabel(props.workspaces)')
  })

  it('keeps the verbs beside the title on a phone, top-aligned with its first line (council round 9 C1)', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&_[data-slot=entity-row-trailing]]:w-auto')
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:items-start')
    expect(InboxView.CARD_HEAD).not.toContain('pr-12')
  })
})

describe('the Inbox phone top bar (round five C4, council round 5)', () => {
  it('seats the status button in the leading corner, left of the centred title, never beside Start triage', () => {
    expect(InboxView.PHONE_BAR_LEADING).toContain('dshx:left-[max(12px,env(safe-area-inset-left,0px))]')
    expect(InboxView.PHONE_BAR_LEADING).toContain('[html:has([data-phone-top-bar][data-phone-stage=attention-inbox])_&]:flex')
    const leading = phoneBar.slice(phoneBar.indexOf('data-inbox-phone-bar="leading"'), phoneBar.indexOf('data-inbox-phone-bar="trailing"'))
    expect(leading).toContain('<status.value.Button />')
    const trailing = phoneBar.slice(phoneBar.indexOf('data-inbox-phone-bar="trailing"'))
    expect(trailing).not.toContain('status.value.Button')
  })
})
