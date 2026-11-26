import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))
const page = panel.slice(panel.lastIndexOf('    <Page\n'))

describe('the Inbox page (council round 7 C1)', () => {
  it('marks its title with the rail glyph in the inbox tone', () => {
    expect(page).toMatch(/mark=\{<InboxIcon \/>\}\s+markTone="inbox"/u)
    expect(page).toContain('width="lane"')
  })

  it('prints every card head in one order: title, project, kind, time', () => {
    const meta = row.slice(row.indexOf('meta={'), row.indexOf('InboxView.relativeAge(item.openedAt, props.now)'))
    const projectAt = meta.indexOf('<ProjectMark name={head.project}')
    const kindAt = meta.indexOf('{head.kind}')
    expect(projectAt).toBeGreaterThan(-1)
    expect(kindAt).toBeGreaterThan(projectAt)
    // Every thread card knows its project, not only a finished turn's.
    expect(row).toMatch(/const project = item\.subject\.kind === 'session' \? props\.projectOf\(item\.subject\.id\) : undefined/u)
  })

  it('names the project on every thread card and the kind unless a project already says it', () => {
    expect(InboxView.headMeta('thread-sidebar.approval', 'billing-api')).toEqual({ project: 'billing-api', kind: 'Approval' })
    expect(InboxView.headMeta('agent-questions.native-question', 'billing-api')).toMatchObject({ project: 'billing-api', kind: 'Thread question' })
    expect(InboxView.headMeta('thread-sidebar.finished-turn', 'web-app')).toEqual({ project: 'web-app', kind: undefined })
    // With no project known a finished turn still says what it is.
    expect(InboxView.headMeta('thread-sidebar.finished-turn', undefined)).toEqual({ project: undefined, kind: 'Thread turns' })
  })
})

const phoneBar = readFileSync(new URL('./inbox-phone-bar.tsx', import.meta.url), 'utf8')
const trailingBar = phoneBar.slice(phoneBar.indexOf('data-inbox-phone-bar="trailing"'))

describe('the phone Inbox (council round 7 C2)', () => {
  // Council round 9 C2 moved Start triage out of the top bar to a worded Triage button (inbox-round9.test.ts).
  it('keeps the top bar to its menu, a 36px ⋯', () => {
    const menu = trailingBar.slice(trailingBar.indexOf('<DropdownMenuTrigger'), trailingBar.indexOf('aria-label={value.moreLabel}'))
    expect(menu).toContain('dshx:size-9')
    expect(trailingBar).not.toContain('primary')
  })

  it('takes 8px, not 12, from the non-interactive gaps on a phone: page top, tabs to list, body to verb, card end', () => {
    expect(page).toContain('dshx:in-data-shell-phone-nav:[&>[data-slot=page-container]]:pt-2')
    expect(page).toContain('dshx:in-data-shell-phone-nav:[&>[data-slot=page-container]>[data-slot=tabs]]:gap-2')
    // Council round 8 C2: the verb follows the evidence on a phone; council round 11 C1 tightened it to 4px above and
    // below (inbox-round11.test.ts).
    expect(InboxView.EVIDENCE).toContain('dshx:@max-pane-narrow:gap-2')
    expect(row).toContain('answers === null && bodyVerbs !== null && InboxView.VERB_MARGIN,')
    // Answers stay 8px apart side by side; a phone stacks them 4px apart (council round 12 C3).
    expect(row.slice(row.indexOf('const answers = '), row.indexOf('const row = '))).toContain('InboxView.ANSWERS')
    expect(InboxView.ANSWERS).toContain('dshx:gap-2')
  })

  it('draws a foot verb 36px tall over the full width; the kit keeps its 44px hit area', () => {
    expect(InboxView.FOOT_VERB).toContain('dshx:@max-pane-narrow:w-full')
    expect(InboxView.FOOT_VERB).toContain('dshx:@max-pane-narrow:h-9!')
    expect(InboxView.FOOT_VERB).not.toContain('dshx:h-11')
  })

  it("seats a failed card's Review and ⋯ 8px inside the card edge (44pt seats since council round 9 C1)", () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:pr-2')
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-1.5')
    expect(row).toContain('data-inbox-card-menu=""')
  })
})
