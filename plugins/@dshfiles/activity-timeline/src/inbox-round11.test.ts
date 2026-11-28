import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const phoneBar = readFileSync(new URL('./inbox-phone-bar.tsx', import.meta.url), 'utf8')
const list = panel.slice(panel.indexOf('const triageable = '))
const trailing = phoneBar.slice(phoneBar.indexOf('data-inbox-phone-bar="trailing"'))

describe('the phone Triage button (council round 11 C1)', () => {
  it('is a worded 44px "Triage" text button in the top bar, before its ⋯', () => {
    const at = trailing.indexOf('data-inbox-phone-triage=""')
    expect(at).toBeGreaterThan(-1)
    const button = trailing.slice(trailing.lastIndexOf('<Button', at), trailing.indexOf('</Button>', at))
    // Council round 13 C1: the kit's bar text button with its glyph (inbox-round13.test.ts).
    expect(button).toMatch(/\{value\.triage\.label\}\s*$/u)
    expect(at).toBeLessThan(trailing.indexOf('<EllipsisIcon'))
    // The page publishes it with its name while something is open to triage, and never while triaging.
    expect(list).toContain("usePublishInboxPhoneActions(triaging || !triageable ? phoneBar : { ...phoneBar, triage: { label: t('triage'), onSelect: () => void startTriage() } })")
  })

  it('leaves the view switcher row to the segments and their tally: no icon, no clearance for one', () => {
    expect(list).not.toContain('data-inbox-phone-triage')
    expect(list).not.toContain('<ListChecksIcon aria-hidden />\n              </Button>')
    expect(list).not.toContain('page-tab-strip]]:pr-13')
    expect(list).toContain('...(tab.statusCounts !== undefined && { statusCounts: tab.statusCounts })')
  })
})

describe('the phone approval card (council round 11 C1)', () => {
  // Council round 16 C3: the command sits in the kit evidence well (inbox-round16.test.ts).
  it('holds "Runs:" inside the well', () => {
    const runs = panel.slice(panel.indexOf('data-inbox-runs=""'), panel.indexOf('</code>', panel.indexOf('data-inbox-runs=""')))
    expect(runs).toContain("<span data-evidence-label=\"\">{t('runs')}</span>")
  })

  // Council round 16 C2: 8px under the block (inbox-round16.test.ts), 4px above the card edge.
  it('sets Review 4px above the card edge', () => {
    expect(InboxView.VERB_MARGIN).toContain('dshx:@max-pane-narrow:pb-1')
    expect(panel).toContain('answers === null && bodyVerbs !== null && InboxView.VERB_MARGIN,')
  })
})

describe('the desktop Inbox card (council round 11 C2)', () => {
  it("puts every card's verb in the head's trailing slot on a desktop; a touch screen foots only several verbs", () => {
    // Approval (a body with a command) and failed (a body or none): head on a fine pointer.
    const card = { compact: false, coarse: false, verbs: 1, answers: false }
    expect(InboxView.footsVerbs(card)).toBe(false)
    expect(InboxView.footsVerbs({ ...card, compact: true })).toBe(false)
    // Council round 18 C1: a phone seats one verb in the head too; several stay under the evidence.
    expect(InboxView.footsVerbs({ ...card, coarse: true })).toBe(false)
    expect(InboxView.footsVerbs({ ...card, coarse: true, verbs: 2 })).toBe(true)
    expect(panel).toContain('const footed = InboxView.footsVerbs({ compact, coarse: phone, verbs: verbCount, answers: answerable })')
    // Answers stay under their question: the answers row draws body verbs only when the card foots them.
    expect(panel).toContain("{footed && hasVerbs && props.actionRow !== false ? verbButtons('body') : null}")
  })

  it('seats the verb 12px before ⋯ (the seat gap plus 8px), and a compact pane keeps its 44pt seats touching', () => {
    expect(InboxView.HEAD_SEAT).toContain('dshx:gap-1')
    expect(InboxView.MENU_AFTER_VERB).toBe('dshx:not-first:ml-2 dshx:@max-pane-narrow:ml-0!')
    const menu = panel.slice(panel.indexOf('data-inbox-card-menu=""'), panel.indexOf('aria-label={t(\'more\')}'))
    expect(menu).toContain('InboxView.MENU_AFTER_VERB')
  })
})

describe('question options (council round 11 C6)', () => {
  const dock = readFileSync(new URL('./thread-question-dock.tsx', import.meta.url), 'utf8')
  it('draws unselected answers as quiet triggers and the recommended one by its tint only, at one weight', () => {
    expect(InboxView.answerVariant(false)).toBe('field')
    expect(InboxView.answerVariant(true)).toBe('attention')
    // Council round 12 C3: that one weight is 500 (inbox-round12.test.ts).
    expect(InboxView.ANSWER).toBe('dshx:font-medium')
    const answers = panel.slice(panel.indexOf('item.choices.map('), panel.indexOf('data-inbox-recommended'))
    expect(answers).toContain('variant={InboxView.answerVariant(choice.recommended === true)}')
    expect(answers).toContain('InboxView.ANSWER,')
    expect(answers).not.toContain("'outline'")
    // The thread's question dock answers the same way: no ink fill for the recommended answer.
    expect(dock).toContain('variant={InboxView.answerVariant(choice.recommended === true)}')
    expect(dock).not.toContain("'default' : 'outline'")
  })
})
