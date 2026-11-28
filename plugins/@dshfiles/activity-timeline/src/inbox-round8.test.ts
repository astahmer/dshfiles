import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))
const meta = row.slice(row.indexOf('meta={'), row.indexOf('{item.occurrences > 1'))

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

  it('opens an approval body with "Runs:" and its command', () => {
    // Council round 16 C3: the command sits in the kit evidence well (inbox-round16.test.ts).
    expect(row).toMatch(/data-inbox-runs=""[^>]*>[\s\S]*?<span data-evidence-label="">\{t\('runs'\)\}<\/span>\{' '\}\s*<code className=\{InboxView\.WELL_CODE\}>\s*\{InboxView\.commandWords\(card\.detail\)/u)
    // It wraps only between words: a phone broke `--env` after its dashes.
    expect(InboxView.commandWords('node scripts/publish-preview.mjs --env preview')).toEqual([
      { text: 'node', keep: true },
      { text: 'scripts/publish-preview.mjs', keep: true },
      { text: '--env', keep: true },
      { text: 'preview', keep: true },
    ])
    expect(InboxView.commandWords('x'.repeat(41))[0]?.keep).toBe(false)
    expect(row).toContain('<span className="dshx:whitespace-nowrap">{word.text}</span>')
  })

  it('a question card keeps its answers as its verbs, any other verb after them', () => {
    const answers = row.slice(row.indexOf('const answers = '), row.indexOf('const evidence ='))
    expect(answers).toContain("{footed && hasVerbs && props.actionRow !== false ? verbButtons('body') : null}")
  })

  it('separates the head parts with a muted "·" and no flex gaps', () => {
    // 4px each side since council round 14 C1, as the kit's AttentionMeta spaces the parts after it.
    expect(InboxView.HEAD_SEP).toBe('dshx:px-1 dshx:text-muted-foreground')
    expect(InboxView.CARD_HEAD).toContain('dshx:[&_[data-slot=entity-row-meta]]:gap-x-0')
    // The "·" after the title leads the meta; AttentionMeta separates project, kind and age itself.
    const lead = meta.indexOf('data-inbox-head-part="lead"')
    expect(lead).toBeGreaterThan(-1)
    expect(meta.indexOf('<HeadSep />', lead)).toBeLessThan(meta.indexOf('<AttentionMeta'))
  })
})

describe('the phone Inbox card head (council round 8 C1)', () => {
  it('names a question "Question" on every width (council round 14 C1: one word list, no phone-only short kind)', () => {
    expect(InboxView.headMeta('agent-questions.native-question', 'billing-api')).toEqual({ project: 'billing-api', kind: 'Question' })
    expect(InboxView.headMeta('thread-sidebar.approval', 'billing-api')).toEqual({ project: 'billing-api', kind: 'Approval' })
    expect(row).not.toContain('data-inbox-kind-short')
  })

  it('keeps the project mark and the kind on a phone; the name too, unless AttentionMeta runs out of room', () => {
    expect(meta).not.toContain('dshx:@max-pane-narrow:hidden')
    expect(InboxView.HEAD_TWO_LINES).not.toContain('data-inbox-project-name')
  })
  // Council round 9 superseded the one-line head (C1: two lines, the full title) and the icon-only Start triage in the
  // top bar (C2: a worded Triage button on the view switcher's row): inbox-round9.test.ts.
})
