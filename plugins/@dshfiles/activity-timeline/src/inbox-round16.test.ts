import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const locales = readFileSync(new URL('./inbox-locales.ts', import.meta.url), 'utf8')

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

describe('Inbox card bodies on the kit evidence well (council round 16 C3)', () => {
  it('quotes an approval\'s command in the neutral well across the text measure, desktop and phone', () => {
    const well = element('data-inbox-runs=""', 'EvidenceWell')
    expect(panel).toContain("import { EvidenceWell } from '@dshfiles/plugin-ui/components/ui/evidence-well'")
    expect(well).not.toContain('tone=')
    expect(well).toContain('className={InboxView.TEXT_MEASURE}')
    expect(well).toContain("<span data-evidence-label=\"\">{t('runs')}</span>")
    expect(well).toContain('<code className={InboxView.WELL_CODE}>')
    // No recipe of its own: the kit owns padding, fill, radius and font; nothing switches on a narrow pane.
    for (const own of ['bg-muted', 'rounded-md', 'py-1.5', '@max-pane-narrow', 'font-mono', 'indent']) expect(well).not.toContain(own)
    for (const gone of ['RUNS_BLOCK', 'COMMAND_BLOCK', 'LEAD_IN', 'COMMAND', 'FAILURE_WELL']) expect(gone in InboxView).toBe(false)
    expect(InboxView.WELL_CODE).toBe('dshx:[font:inherit]')
    // The body spans the card, so the well is never shrink-to-content.
    expect(InboxView.WELL_BODY).toContain('dshx:w-full')
    expect(panel).toContain("card.command ? InboxView.WELL_BODY : 'dshx:flex dshx:min-w-0 dshx:flex-[0_1_auto] dshx:flex-col dshx:gap-0.5'")
  })

  it('shows a failed turn\'s provider line as "Error: <line>" in the danger well, and no well without one', () => {
    const well = element('data-inbox-failure-well={failure.kind}', 'EvidenceWell')
    expect(well).toContain('tone="danger"')
    expect(well).toContain('InboxView.WELL_CLAMP_ERROR')
    expect(panel).toContain("<span data-evidence-label=\"\">{t('failedErrorLabel')}</span> {failure.line}")
    expect(panel).toContain("failure === null || failure.kind === 'stopped-on-error' ? null")
    expect(panel).toMatch(/failure !== null \? \(\s*failureText === null \? null : \(/u)
    expect(locales).toContain("failedErrorLabel: 'Error:',")
    expect(locales).toContain("failedErrorLabel: '错误：',")
    expect(locales).not.toContain('failedOnError')
    // A failed card without a body stays one compact row with its Review in the head.
    expect(InboxView.compact('failed', { reason: null, detail: null })).toBe(true)
    expect(InboxView.footsVerbs(true, true)).toBe(false)
  })
})
