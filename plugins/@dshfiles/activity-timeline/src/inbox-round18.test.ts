import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { INBOX_CHIP } from './triage-stage.js'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')

/** The JSX of the element opened before `marker`, up to its closing tag. */
const element = (marker: string, tag: string): string => {
  const at = panel.indexOf(marker)
  expect(at).toBeGreaterThan(-1)
  return panel.slice(panel.lastIndexOf(`<${tag}`, at), panel.indexOf(`</${tag}>`, at))
}

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

describe('phone card trims (council round 18 C2)', () => {
  it('puts the card ⋯ seat on the card\'s inner edge: its glyph on x 349 at 390pt, the thread list\'s axis', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:pr-0')
    expect(InboxView.CARD_HEAD).not.toContain('[&>div:first-child]:pr-2')
  })

  it('sets "Recommended" as a trailing annotation, 8px or more after the answer', () => {
    expect(InboxView.RECOMMENDED).toBe('dshx:shrink-0 dshx:ms-auto dshx:ps-0.5 dshx:text-xs dshx:font-normal dshx:text-muted-foreground')
    expect(InboxView.RECOMMENDED).not.toContain('ml-1.5')
  })

  it('starts the pencil and the recommended label on the bordered answers\' label edge (1px edge + 16px)', () => {
    expect(InboxView.BORDERLESS_EDGE).toBe('dshx:pointer-coarse:pl-[17px]!')
    expect(InboxView.WRITE_OWN).toContain(InboxView.BORDERLESS_EDGE)
    // Merged after the chip's 16px inset, so it is the one leading inset left.
    const writeOwn = cn(INBOX_CHIP, InboxView.ANSWER, InboxView.ANSWER_ROW, InboxView.WRITE_OWN)
    expect(writeOwn).toContain('dshx:pointer-coarse:pl-[17px]!')
    expect(element('data-inbox-write-own=""', 'Button')).toContain('InboxView.WRITE_OWN')
    expect(panel).toContain('choice.recommended === true && InboxView.BORDERLESS_EDGE)}')
  })
})
