import { readFileSync } from 'node:fs'
import { ATTENTION_KIND_LABEL } from '@dshfiles/plugin-ui/components/ui/attention-meta'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'
import { INBOX_CHIP } from './triage-stage.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')

describe('the phone failed card\'s Review (council round 14 C2)', () => {
  it('keeps a 44pt target on a touch screen, 28px on a desktop', () => {
    const merged = cn(INBOX_CHIP, cn('dshx:shrink', InboxView.HEAD_VERB))
    // Council round 19 C1: drawn 36pt with a 4pt hit slop above and below (inbox-round19.test.ts).
    expect(merged).toContain('dshx:pointer-coarse:h-9')
    expect(merged).toContain('dshx:pointer-coarse:before:-inset-y-1')
    expect(merged).not.toContain('pointer-coarse:h-7')
    expect(merged).toContain('dshx:h-7')
  })

  it('sits centred in the 52px head band (4px above and below), so the head and the card keep their height', () => {
    // 6px head padding less 2px each side: a 44pt seat takes the band's 40px inner height, no more.
    const seat = cn(InboxView.HEAD_SEAT, InboxView.HEAD_SEAT_VERB)
    expect(seat).toContain('dshx:@max-pane-narrow:-my-0.5!')
    expect(seat).not.toContain('dshx:@max-pane-narrow:-my-2!')
    // Only a touch screen's head that holds a verb (a failed or, since council round 18 C1, an approval card): a ⋯ alone
    // stays level with the title.
    expect(panel).toContain('className={cn(InboxView.HEAD_SEAT, phone && !footed && hasVerbs && InboxView.HEAD_SEAT_VERB)}')
  })
})

describe('the card head\'s meta line (council round 14 C1)', () => {
  const meta = panel.slice(panel.indexOf('meta={'), panel.indexOf('</EntityRow>', panel.indexOf('meta={')))

  it('speaks the one word list: Approval, Question, Turn failed (never "Thread question")', () => {
    expect(InboxView.headMeta('thread-sidebar.approval', 'billing-api')).toEqual({ project: 'billing-api', kind: ATTENTION_KIND_LABEL.approval })
    expect(InboxView.headMeta('agent-questions.native-question', 'billing-api')).toEqual({ project: 'billing-api', kind: ATTENTION_KIND_LABEL.question })
    expect(InboxView.headMeta('thread-sidebar.finished-turn', 'web-app', true)).toEqual({ project: 'web-app', kind: ATTENTION_KIND_LABEL.failed })
    expect(InboxView.sourceLabel('agent-questions.native-question')).toBe('Question')
  })

  it('draws ProjectMark project · kind · age with the kit\'s AttentionMeta, desktop and phone alike', () => {
    expect(meta).toMatch(/<AttentionMeta\s[^>]*project=\{head\.project\}\s+kind=\{head\.kind\}\s+age=\{InboxView\.headAge\(item\.openedAt, props\.now, phone\)\}/u)
    // Its own mark, name, kind and age parts are gone: one formatter, no phone-only short kind, no hidden name.
    for (const gone of ['<ProjectMark', 'data-inbox-project-name', 'data-inbox-kind-short', 'data-inbox-kind-long', 'data-inbox-age', 'head.shortKind']) expect(meta).not.toContain(gone)
    expect(InboxView.HEAD_TWO_LINES).not.toContain('data-inbox-project-name')
    expect(InboxView.CARD_HEAD).not.toContain('data-inbox-kind-short')
  })

  it('lets the line grow to the head\'s width, so it measures the room it really has', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:[&_[data-slot=entity-row-meta]]:flex-auto')
    // 13/18 on a phone, as the two-line head had (a 52px head).
    expect(meta).toContain('className={InboxView.HEAD_META}')
    expect(InboxView.HEAD_META).toContain('dshx:@max-pane-narrow:leading-4.5')
  })
})

describe('the desktop question card\'s quiet verb (council round 14 C3)', () => {
  it('reads "Open thread" (its open label), never a → (council round 16 C2 gives it ↗, inbox-round16.test.ts)', () => {
    const at = panel.indexOf('data-inbox-open-head=""')
    const button = panel.slice(panel.lastIndexOf('<Button', at), panel.indexOf('</Button>', at))
    expect(button).toContain('{openLabel}')
    expect(button).not.toContain("{t('open')}")
    expect(button).not.toContain('ArrowRightIcon')
  })
})

describe('the desktop "Needs you" tab (council round 14 C3)', () => {
  it('shows the status tally (◆ 2 · ✕ 1) in place of its plain count, as the phone does', () => {
    const page = panel.slice(panel.indexOf('mark={<InboxIcon />}\n      markTone="inbox"\n      heading={t(\'title\')}'))
    expect(page).toContain("'dshx:[&_[data-slot=page-tab-count]]:hidden dshx:[&_[data-slot=page-tab-status-counts]]:inline-flex'")
  })
})
