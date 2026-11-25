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
    expect(InboxView.headMeta('agent-questions.native-question', 'billing-api')).toEqual({ project: 'billing-api', kind: 'Thread question' })
    expect(InboxView.headMeta('thread-sidebar.finished-turn', 'web-app')).toEqual({ project: 'web-app', kind: undefined })
    // With no project known a finished turn still says what it is.
    expect(InboxView.headMeta('thread-sidebar.finished-turn', undefined)).toEqual({ project: undefined, kind: 'Thread turns' })
  })
})

const phoneBar = readFileSync(new URL('./inbox-phone-bar.tsx', import.meta.url), 'utf8')
const trailingBar = phoneBar.slice(phoneBar.indexOf('data-inbox-phone-bar="trailing"'))

describe('the phone Inbox (council round 7 C2)', () => {
  it('ends the top bar with the page menu: Start triage first, then the ⋯ on the trailing edge', () => {
    expect(trailingBar.indexOf('data-page-action={primary.id}')).toBeGreaterThan(-1)
    expect(trailingBar.indexOf('aria-label={value.moreLabel}')).toBeGreaterThan(trailingBar.indexOf('data-page-action={primary.id}'))
  })

  it('draws Start triage as a quiet 36px outline button with a 44px hit area, not the ink primary', () => {
    const primary = trailingBar.slice(trailingBar.indexOf('{primary === undefined ? null : ('), trailingBar.indexOf('data-page-action={primary.id}'))
    expect(primary).toContain('variant="outline"')
    expect(primary).toContain('dshx:h-9')
    expect(primary).toContain('dshx-hit-44')
    // The 12px small label keeps it clear of the centred "Inbox" title at 390px; the bar's ⋯ is 36px too.
    expect(primary).not.toContain('dshx:text-sm')
    const menu = trailingBar.slice(trailingBar.indexOf('<DropdownMenuTrigger'), trailingBar.indexOf('aria-label={value.moreLabel}'))
    expect(menu).toContain('dshx:size-9')
    expect(menu).not.toContain('dshx:size-11')
  })

  it('takes 8px, not 12, from the non-interactive gaps on a phone: page top, tabs to list, body to verb, card end', () => {
    expect(page).toContain('dshx:in-data-shell-phone-nav:[&>[data-slot=page-container]]:pt-2')
    expect(page).toContain('dshx:in-data-shell-phone-nav:[&>[data-slot=page-container]>[data-slot=tabs]]:gap-2')
    expect(InboxView.FOOT_VERBS).toContain('dshx:pb-2')
    expect(InboxView.FOOT_VERBS).not.toContain('dshx:pb-3')
    expect(row).toContain("footed && hasVerbs && props.actionRow !== false && 'dshx:@max-pane-narrow:pb-2'")
    // Answers stay 8px apart.
    expect(row.slice(row.indexOf('const answers = '), row.indexOf('const row = '))).toContain('dshx:gap-2')
  })

  it('draws a foot verb 36px tall over the full width; the kit keeps its 44px hit area', () => {
    expect(InboxView.FOOT_VERB).toContain('dshx:w-full')
    expect(InboxView.FOOT_VERB).toContain('dshx:h-9!')
    expect(InboxView.FOOT_VERB).not.toContain('dshx:h-11')
  })

  it("insets a failed card's Review pill 8px from the card edge: 36px controls, the head padded 12px", () => {
    expect(InboxView.COMPACT_SEAT).toContain('dshx:@max-pane-narrow:[&_[data-inbox-row-actions=band]]:-my-1!')
    expect(InboxView.COMPACT_SEAT).toContain('dshx:@max-pane-narrow:[&_[data-inbox-row-actions=band]_[data-slot=button]]:h-9!')
    expect(InboxView.COMPACT_SEAT).toContain('dshx:@max-pane-narrow:[&_[data-inbox-row-actions=band]_[data-inbox-card-menu]]:size-9!')
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-3')
    expect(row).toContain('data-inbox-card-menu=""')
  })
})
