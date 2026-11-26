import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')

/** The JSX of the element opened before `marker`, up to its closing tag. */
const element = (marker: string, tag: string): string => {
  const at = panel.indexOf(marker)
  expect(at).toBeGreaterThan(-1)
  return panel.slice(panel.lastIndexOf(`<${tag}`, at), panel.indexOf(`</${tag}>`, at))
}

describe('the answer is the strongest control on an Inbox card (council round 16 C2)', () => {
  it('draws a question card\'s "Open thread" as a quiet ghost in secondary ink with ↗, never the band-tinted pill', () => {
    const button = element('data-inbox-open-head=""', 'Button')
    expect(button).toContain('variant="ghost"')
    expect(button).toContain('InboxView.QUIET_OPEN')
    expect(button).toContain('<ArrowUpRightIcon aria-hidden />')
    for (const loud of ['InboxView.headVariant(status)', 'band=']) expect(button).not.toContain(loud)
    expect(InboxView.QUIET_OPEN).toContain('dshx:text-muted-foreground')
    expect(InboxView.QUIET_OPEN).toContain('dshx:hover:text-foreground')
    // The recommended answer keeps the tint; the other answers keep the resting trigger look.
    expect(InboxView.answerVariant(true)).toBe('attention')
    expect(InboxView.answerVariant(false)).toBe('field')
  })

  it('keeps Review the band-tinted pill on approval and failed cards', () => {
    expect(InboxView.headVariant('needs-you')).toBe('attention')
    expect(InboxView.headVariant('failed')).toBe('danger-tint')
    expect(InboxView.onBand('needs-you')).toBe(true)
    expect(InboxView.onBand('failed')).toBe(true)
  })

  it('draws a phone\'s Review 44pt tall over the full width, 8pt under the evidence', () => {
    expect(InboxView.FOOT_VERB).toContain('dshx:@max-pane-narrow:w-full')
    expect(InboxView.FOOT_VERB).toContain('dshx:@max-pane-narrow:h-11!')
    expect(InboxView.FOOT_VERB).not.toContain('h-9')
    expect(InboxView.VERB_MARGIN).toBe('dshx:@max-pane-narrow:gap-2 dshx:@max-pane-narrow:pb-1')
    expect(panel).toContain('answers === null && bodyVerbs !== null && InboxView.VERB_MARGIN,')
  })
})

