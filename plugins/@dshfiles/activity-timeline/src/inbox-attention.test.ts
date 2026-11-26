import { readFileSync } from 'node:fs'
import { PaletteMath, WARM_STONE, type Scheme } from '@dshfiles/plugin-ui/theme/palette'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'
import { INBOX_CHIP } from './triage-stage.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))

describe('Inbox colour on things you act on (round five P2)', () => {
  it('gives the attention verb the tint rung: Needs you indigo, Failed red, others outline', () => {
    expect(InboxView.attentionVariant('needs-you')).toBe('attention')
    expect(InboxView.attentionVariant('failed')).toBe('danger-tint')
    expect(InboxView.attentionVariant('ready')).toBe('outline')
    // Council round 11 C6: quiet triggers, the recommended answer by its tint (inbox-round11.test.ts).
    expect(row).toContain('variant={InboxView.answerVariant(choice.recommended === true)}')
    // A Failed head's verb is red text on its red band (council round 9 C3); a body verb keeps the tint rung.
    expect(row).toContain("place === 'head' ? InboxView.headVariant(status) : InboxView.attentionVariant(status)")
  })

  it('draws no ink button in a card: the page keeps one ink primary, Start triage', () => {
    expect(row).not.toMatch(/'default'/u)
    expect(panel).toMatch(/const triageOnTop = resumeAllAction === null && triageable/u)
  })

  it('folds the utility verbs (Done, Snooze, quick replies, mute) into the card menu', () => {
    const actions = row.slice(row.indexOf('data-inbox-row-actions'), row.indexOf('<AlertDialog '))
    expect(actions).not.toMatch(/<Button[^>]*onClick=\{\(\) => props\.onDone\(item\)\}/u)
    expect(actions).not.toMatch(/<Button[^>]*>\s*<ClockIcon/u)
    expect(actions).toMatch(/<DropdownMenuItem[^>]*onSelect=\{\(\) => props\.onDone\(item\)\}/u)
    expect(actions).toMatch(/quickReplies\.map\(reply => \(\s*<DropdownMenuItem/u)
  })

  it('bands the head of a Needs-you or Failed card in its attention wash (round five C4, kit A2)', () => {
    // Round five C3 (council round 3): a full-width band takes the kit's calmer band wash (A2), rows keep the row wash.
    expect(InboxView.headerBand('needs-you')).toBe('dshx:[&>div:first-child]:bg-wash-needs-you-band')
    expect(InboxView.headerBand('failed')).toBe('dshx:[&>div:first-child]:bg-wash-failed')
    expect(InboxView.headerBand('ready')).toBe('')
    expect(row).toContain('InboxView.headerBand(status)')
  })

  it.each<Scheme>(['light', 'dark'])('keeps ink and muted text at AA on the band (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const band of [p.needsYouBandWash, p.failedWash]) {
      expect(PaletteMath.contrastRatio(p.neutral[9]!, band), 'muted on the band').toBeGreaterThanOrEqual(4.5)
      expect(PaletteMath.contrastRatio(p.neutral[10]!, band), 'ink on the band').toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('Inbox card (round five C4)', () => {
  it('is one card surface: rounded, clipped, the band flush with its top, on desktop and phone', () => {
    expect(InboxView.CARD).toBe('dshx:relative dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card')
    expect(row).toContain('className={InboxView.CARD}')
    // No second surface: the row carries no inset padding or own radius inside the card, and no muted fill behind it.
    expect(row).not.toContain('dshx:bg-muted">')
    expect(row).not.toContain("'dshx:relative dshx:bg-card dshx:py-1'")
    expect(row).toContain('dshx:rounded-none')
    // The card wrapper is not phone-only.
    expect(row).not.toContain('if (!phone) return row')
  })

  it('keeps the head band to glyph, title, type and age: the question sits in the neutral body', () => {
    // The verbs are built before the row (round five C3, council round 4: a compact Failed item carries them in the band).
    const entity = row.slice(row.indexOf('<EntityRow'), row.indexOf('</EntityRow>'))
    expect(entity).not.toMatch(/\bdescription=\{/u)
    // Council round 8 C2: the body (evidence, then its verbs) is built before the row and drawn under the band.
    expect(entity).toContain('data-inbox-card-evidence')
    expect(row).toContain('data-inbox-card-body')
  })

  it('labels the recommended answer in words, not only in its tint', () => {
    const choices = row.slice(row.indexOf('item.choices.map('), row.indexOf('const row = '))
    expect(choices).toContain('data-inbox-recommended')
    expect(choices).not.toMatch(/dshx:sr-only"> \(\{t\('recommended'\)\}\)/u)
  })

  it('offers a custom reply beside the answer rows', () => {
    const choices = row.slice(row.indexOf('item.choices.map('), row.indexOf('const row = '))
    expect(choices).toContain("t('writeOwn')")
    expect(choices).toContain('data-inbox-write-own')
    // On a phone it shares its line with the card's menu instead of taking a full-width row and leaving the menu alone.
    const writeOwn = choices.slice(choices.indexOf('data-inbox-write-own'), choices.indexOf("t('writeOwn')"))
    expect(writeOwn).not.toContain('dshx:pointer-coarse:w-full')
  })

  it('names a failed thread once: the reason drops a quoted copy of the title', () => {
    expect(InboxView.bodyReason('“Upgrade the router to v8” failed', 'Upgrade the router to v8')).toBeNull()
    expect(InboxView.bodyReason('"Upgrade the router to v8" failed', 'Upgrade the router to v8')).toBeNull()
    expect(InboxView.bodyReason('Asks: Which rate?', 'Reconcile Stripe payouts')).toBe('Asks: Which rate?')
    expect(InboxView.bodyReason('“Deploy” failed: the registry refused the push', 'Deploy')).toBe('“Deploy” failed: the registry refused the push')
    expect(row).toContain('InboxView.bodyReason(text.reason, title)')
  })

  it('caps the page at the kit list lane (920 px) instead of stretching across a wide pane (round five C3, kit A5)', () => {
    expect(panel.match(/width="lane"/gu)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('Inbox on a phone (round five P2)', () => {
  it('hides the page description so Start triage sits in the first row', () => {
    expect(panel).toMatch(/description=\{<span className="dshx:in-data-shell-phone-nav:hidden">\{t\('subtitle'\)\}<\/span>\}/u)
  })

  it('puts the header actions (Start triage, the page menu) in the phone top bar, not a row of their own (round five C4)', () => {
    expect(panel).toContain('usePublishInboxPhoneActions(')
    // Drawn from the frame's root overlay: inside the workbench pane a transform would pin a fixed bar to the page.
    expect(readFileSync(new URL('./client.tsx', import.meta.url), 'utf8')).toMatch(
      /name: 'shell\.overlay', id: 'dshfiles-inbox-phone-bar'[^)]*\}, InboxPhoneBar\)/u,
    )
    // Shown only while the Inbox is the stage the phone top bar names; the page header keeps them on wider screens.
    expect(InboxView.PHONE_BAR).toContain('[html:has([data-phone-top-bar][data-phone-stage=attention-inbox])_&]:flex')
    expect(InboxView.PHONE_BAR).toContain('dshx:hidden')
    expect(panel).toContain('dshx:in-data-shell-phone-nav:[&_[data-slot=page-header]]:hidden')
    expect(InboxView.PHONE_BAR).toContain('dshx:right-[max(12px,env(safe-area-inset-right,0px))]')
  })

  it('keeps the mark and kind in the phone head, on the line under the full title (council round 9 C1)', () => {
    expect(row).toMatch(/data-inbox-head-part="kind" className=\{InboxView\.HEAD_PART\}/u)
    expect(row).toContain('data-inbox-project-name=""')
    expect(row).toContain('InboxView.HEAD_TWO_LINES')
  })

  it('draws answer options as full-width 44 px rows with an 8 px radius, not 48 px pills', () => {
    expect(INBOX_CHIP).toContain('dshx:pointer-coarse:h-11')
    expect(INBOX_CHIP).toContain('dshx:pointer-coarse:rounded-lg')
    expect(INBOX_CHIP).not.toContain('rounded-full')
    const choices = row.slice(row.indexOf('item.choices.map('), row.indexOf('const row = '))
    expect(choices).toContain('dshx:pointer-coarse:w-full')
    expect(choices).toContain('dshx:pointer-coarse:justify-start')
  })

  it('never clamps a question the card can answer', () => {
    const question = { verbs: ['Answer'], choices: [{ id: 'a', label: 'A' }] } as const
    expect(InboxView.clampsText(question, 'needs-you')).toBe(false)
    expect(InboxView.clampsText({ verbs: ['Done'], choices: [] }, 'needs-you')).toBe(true)
    expect(InboxView.clampsText(question, 'closed')).toBe(true)
    expect(row).toContain('InboxView.clampsText(item, props.view)')
  })
})
