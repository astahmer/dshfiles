import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))
const meta = row.slice(row.indexOf('meta={'), row.indexOf('{item.occurrences > 1'))
const phoneBar = readFileSync(new URL('./inbox-phone-bar.tsx', import.meta.url), 'utf8')
const trailingBar = phoneBar.slice(phoneBar.indexOf('data-inbox-phone-bar="trailing"'))

describe('one Inbox card structure (council round 8 C2)', () => {
  it('draws the verbs in the body right after the evidence, on every width, never in the head of a card with a body', () => {
    expect(row).toContain('data-inbox-card-evidence=""')
    const evidenceBlock = row.slice(row.indexOf('data-inbox-card-evidence=""'), row.indexOf('{props.actionRow === false ? null : answers}'))
    expect(evidenceBlock.indexOf('{evidence}')).toBeGreaterThan(-1)
    expect(evidenceBlock.indexOf('{bodyVerbs}')).toBeGreaterThan(evidenceBlock.indexOf('{evidence}'))
    // The head's seat holds verbs only for a bodyless card; the wide-only head copy is gone.
    expect(row).toContain("{footed ? null : verbButtons('head')}")
    expect(panel).not.toContain('HEAD_VERBS_WIDE')
    expect(row).not.toContain('data-inbox-row-actions="foot"')
    // 12px beside the evidence on a wide pane; under it on a phone.
    expect(InboxView.EVIDENCE).toContain('dshx:gap-x-3')
    expect(InboxView.EVIDENCE).toContain('dshx:@max-pane-narrow:flex-col')
  })

  it('opens an approval body with "Runs:" and its command in 12/16 ink mono', () => {
    expect(row).toMatch(/data-inbox-runs=""[^>]*>\s*\{t\('runs'\)\}\{' '\}\s*<code className=\{cn\(InboxView\.COMMAND, InboxView\.COMMAND_BLOCK\)\}>\s*\{InboxView\.commandWords\(card\.detail\)/u)
    // It wraps only between words: a phone broke `--env` after its dashes.
    expect(InboxView.commandWords('node scripts/publish-preview.mjs --env preview')).toEqual([
      { text: 'node', keep: true },
      { text: 'scripts/publish-preview.mjs', keep: true },
      { text: '--env', keep: true },
      { text: 'preview', keep: true },
    ])
    expect(InboxView.commandWords('x'.repeat(41))[0]?.keep).toBe(false)
    expect(row).toContain('<span className="dshx:whitespace-nowrap">{word.text}</span>')
    expect(InboxView.COMMAND).toBe('dshx:font-mono dshx:text-xs dshx:leading-4 dshx:text-foreground')
    expect(InboxView.LEAD_IN).toContain('dshx:text-xs dshx:leading-4 dshx:text-muted-foreground')
  })

  it('a question card keeps its answers as its verbs, any other verb after them', () => {
    const answers = row.slice(row.indexOf('const answers = '), row.indexOf('const evidence ='))
    expect(answers).toContain("{footed && hasVerbs && props.actionRow !== false ? verbButtons('body') : null}")
  })

  it('separates the head parts with a muted "·", 6px each side, and no flex gaps', () => {
    expect(InboxView.HEAD_SEP).toBe('dshx:px-1.5 dshx:text-muted-foreground')
    expect(InboxView.CARD_HEAD).toContain('dshx:[&_[data-slot=entity-row-meta]]:gap-x-0')
    for (const part of ['project', 'kind', 'age']) {
      const at = meta.indexOf(`data-inbox-head-part="${part}"`)
      expect(at).toBeGreaterThan(-1)
      expect(meta.indexOf('<HeadSep />', at)).toBeGreaterThan(at)
    }
    // Order: project, kind, time.
    expect(meta.indexOf('data-inbox-head-part="project"')).toBeLessThan(meta.indexOf('data-inbox-head-part="kind"'))
    expect(meta.indexOf('data-inbox-head-part="kind"')).toBeLessThan(meta.indexOf('data-inbox-head-part="age"'))
  })
})

describe('the phone Inbox card head (council round 8 C1)', () => {
  it('names a question "Question" on a phone, where "Thread question" left the title a few letters', () => {
    expect(InboxView.headMeta('agent-questions.native-question', 'billing-api')).toEqual({ project: 'billing-api', kind: 'Thread question', shortKind: 'Question' })
    expect(InboxView.headMeta('thread-sidebar.approval', 'billing-api')).toEqual({ project: 'billing-api', kind: 'Approval' })
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&_[data-inbox-kind-short]]:inline')
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&_[data-inbox-kind-long]]:hidden')
    expect(row).toContain('<span data-inbox-kind-short="">{head.shortKind}</span>')
  })

  it('keeps the project mark and the kind on a phone; only the project name hides', () => {
    expect(meta).not.toContain('dshx:@max-pane-narrow:hidden')
    expect(InboxView.HEAD_TWO_LINES).toContain('dshx:@max-pane-narrow:[&_[data-inbox-project-name]]:hidden')
  })
  // Council round 9 C1 superseded the one-line head (two lines, the full title): inbox-round9.test.ts.

  it('draws Start triage as a 44x44 icon-only button, named by aria-label and tooltip, before the ⋯', () => {
    const primary = trailingBar.slice(trailingBar.indexOf('<TooltipProvider>'), trailingBar.indexOf('</TooltipProvider>'))
    expect(primary).toContain('size="icon"')
    expect(primary).toContain('dshx:size-11')
    expect(primary).toContain('aria-label={primary.label}')
    expect(primary).toMatch(/<TooltipContent[^>]*>\s*\{primary\.label\}/u)
    expect(primary).not.toMatch(/\{primary\.icon\}\s*\{primary\.label\}/u)
    expect(trailingBar.indexOf('aria-label={value.moreLabel}')).toBeGreaterThan(trailingBar.indexOf('</TooltipProvider>'))
  })
})
