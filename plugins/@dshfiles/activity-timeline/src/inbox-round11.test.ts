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
    expect(button).toContain('variant="ghost"')
    expect(button).toMatch(/>\s*\{value\.triage\.label\}\s*$/u)
    expect(at).toBeLessThan(trailing.indexOf('<EllipsisIcon'))
    expect(InboxView.PHONE_TRIAGE).toContain('dshx:h-11')
    expect(InboxView.PHONE_TRIAGE).toContain('dshx:text-foreground')
    expect(InboxView.PHONE_TRIAGE).not.toContain('dshx:w-11')
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
  it('captions its command block "Runs" inside the block, at 12px', () => {
    const runs = panel.slice(panel.indexOf('data-inbox-runs=""'), panel.indexOf('</code>', panel.indexOf('data-inbox-runs=""')))
    expect(runs).toContain('InboxView.RUNS_BLOCK')
    expect(runs).toMatch(/<span data-inbox-runs-caption="" className=\{InboxView\.RUNS_CAPTION\}>\s*\{t\('runsCaption'\)\}/u)
    expect(runs).toContain("<span className={InboxView.RUNS_INLINE}>{t('runs')}</span>")
    // The block (fill, radius, inset) is the runs line, not the code inside it.
    expect(InboxView.RUNS_BLOCK).toContain('dshx:@max-pane-narrow:bg-muted')
    expect(InboxView.COMMAND_BLOCK).not.toContain('bg-muted')
    expect(InboxView.COMMAND_BLOCK).not.toContain('mt-1')
    expect(InboxView.LEAD_IN).toContain('dshx:text-xs dshx:leading-4')
    expect(InboxView.RUNS_CAPTION).toContain('dshx:@max-pane-narrow:block')
  })

  it('sets Review 4px under the block and 4px above the card edge', () => {
    expect(InboxView.VERB_MARGIN).toBe('dshx:@max-pane-narrow:gap-1 dshx:@max-pane-narrow:pb-1')
    expect(panel).toContain('answers === null && bodyVerbs !== null && InboxView.VERB_MARGIN,')
  })
})

describe('the desktop Inbox card (council round 11 C2)', () => {
  it("puts every card's verb in the head's trailing slot on a desktop; a touch screen keeps a body's verb under its evidence", () => {
    // Approval (a body with a command) and failed (a body or none): head on a fine pointer.
    expect(InboxView.footsVerbs(false, false)).toBe(false)
    expect(InboxView.footsVerbs(true, false)).toBe(false)
    // A phone keeps the verb under the evidence, and a bodyless failure in the head.
    expect(InboxView.footsVerbs(false, true)).toBe(true)
    expect(InboxView.footsVerbs(true, true)).toBe(false)
    expect(panel).toContain('const footed = InboxView.footsVerbs(compact, phone)')
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
    expect(InboxView.ANSWER).toBe('dshx:font-normal')
    const answers = panel.slice(panel.indexOf('item.choices.map('), panel.indexOf('data-inbox-recommended'))
    expect(answers).toContain('variant={InboxView.answerVariant(choice.recommended === true)}')
    expect(answers).toContain('InboxView.ANSWER,')
    expect(answers).not.toContain("'outline'")
    // The thread's question dock answers the same way: no ink fill for the recommended answer.
    expect(dock).toContain('variant={InboxView.answerVariant(choice.recommended === true)}')
    expect(dock).not.toContain("'default' : 'outline'")
  })
})
