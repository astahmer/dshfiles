import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')

describe('one phone card action pattern (council round 18 C1)', () => {
  const card = { compact: false, coarse: true, verbs: 1, answers: false }

  it("seats a phone approval's one Review in its head beside ⋯, as the failed card's", () => {
    // An approval: a body (its command) and one verb. A footer Review cost the fold 52pt.
    expect(InboxView.footsVerbs(card)).toBe(false)
    // A failed card, with its error well or without a body.
    expect(InboxView.footsVerbs({ ...card, compact: true })).toBe(false)
    // A desktop already seats every verb in the head.
    expect(InboxView.footsVerbs({ ...card, coarse: false })).toBe(false)
    expect(InboxView.footsVerbs({ ...card, coarse: false, verbs: 3 })).toBe(false)
  })

  it('keeps a question\'s answers in its body, and several verbs under their evidence', () => {
    expect(InboxView.footsVerbs({ ...card, answers: true })).toBe(true)
    expect(InboxView.footsVerbs({ ...card, verbs: 2 })).toBe(true)
  })

  it('counts the verbs the card draws, so one verb is one head pill', () => {
    expect(panel).toContain('const footed = InboxView.footsVerbs({ compact, coarse: phone, verbs: verbCount, answers: answerable })')
    expect(panel).toContain('const hasVerbs = verbCount > 0')
    expect(panel).toMatch(/const verbCount =\s*\(open \? PROVIDER_VERBS\.filter\(verb => item\.verbs\.includes\(verb\)\)\.length : 0\) \+/u)
  })

  it('centres a head that holds a verb on both head lines, and leaves a lone ⋯ level with the title', () => {
    expect(panel).toContain('className={cn(InboxView.HEAD_SEAT, phone && !footed && hasVerbs && InboxView.HEAD_SEAT_VERB)}')
    // The 44pt pill keeps the head 52px: 2px into its 6px padding.
    expect(cn(InboxView.HEAD_SEAT, InboxView.HEAD_SEAT_VERB)).toContain('dshx:@max-pane-narrow:-my-0.5!')
  })

  it('wraps a long title to two lines beside the pill on a phone, never moving the pill to a footer', () => {
    expect(InboxView.TITLE).toBe('dshx:text-heading dshx:@max-pane-narrow:line-clamp-2')
  })
})
