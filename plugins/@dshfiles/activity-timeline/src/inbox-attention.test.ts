import { readFileSync } from 'node:fs'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '@dshfiles/plugin-ui/theme/palette'
import { describe, expect, it } from 'vitest'
import { InboxView } from './inbox-view.js'
import { INBOX_CHIP } from './triage-stage.js'

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const row = panel.slice(panel.indexOf('const InboxRow = '), panel.indexOf('const InboxActionSheet = '))

/** `over` at `alpha` on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const composite = (under: Oklch, over: Oklch, alpha: number): Oklch => {
  const channels = (color: Oklch): readonly number[] => (PaletteMath.toHex(color).slice(1).match(/../gu) ?? []).map(pair => Number.parseInt(pair, 16))
  const [u, o] = [channels(under), channels(over)]
  const hex = u.map((value, index) => Math.round(value * (1 - alpha) + (o[index] ?? 0) * alpha).toString(16).padStart(2, '0')).join('')
  return PaletteMath.hexToOklch(`#${hex}`)
}

describe('Inbox colour on things you act on (round five P2)', () => {
  it('gives the attention verb the tint rung: Needs you indigo, Failed red, others outline', () => {
    expect(InboxView.attentionVariant('needs-you')).toBe('attention')
    expect(InboxView.attentionVariant('failed')).toBe('danger-tint')
    expect(InboxView.attentionVariant('ready')).toBe('outline')
    expect(row).toContain("variant={choice.recommended === true ? 'attention' : 'outline'}")
    expect(row).toMatch(/variant=\{open && !item\.verbs\.includes\('Answer'\) \? InboxView\.attentionVariant\(status\) : 'ghost'\}/u)
  })

  it('draws no ink button in a card: the page keeps one ink primary, Start triage', () => {
    expect(row).not.toMatch(/'default'/u)
    expect(panel).toMatch(/const triageOnTop = resumeAllAction === null && triageable/u)
  })

  it('folds the utility verbs (Done, Snooze, quick replies, mute) into the card menu', () => {
    const actions = row.slice(row.indexOf('data-inbox-row-actions'), row.indexOf('<AlertDialog '))
    expect(actions).not.toMatch(/<Button[^>]*onClick=\{\(\) => props\.onDone\(item\)\}/u)
    expect(actions).not.toMatch(/<Button[^>]*>\s*<ClockIcon/u)
    expect(actions).toMatch(/<DropdownMenuItem[^>]*onSelect=\{\(\) => props\.onDone\(item\)\}/u)
    expect(actions).toMatch(/quickReplies\.map\(reply => \(\s*<DropdownMenuItem/u)
  })

  it('bands the head of a Needs-you or Failed card in its status tint', () => {
    expect(InboxView.headerBand('needs-you')).toContain('dshx:[&>div:first-child]:bg-status-needs-you/6')
    expect(InboxView.headerBand('failed')).toContain('dshx:[&>div:first-child]:bg-status-failed/6')
    expect(InboxView.headerBand('ready')).toBe('')
    expect(row).toContain('InboxView.headerBand(status)')
  })

  it.each<Scheme>(['light', 'dark'])('keeps ink and muted text at AA on the band (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    for (const [name, step] of [['bg', 0], ['panel', 1], ['raised', 2]] as const) {
      for (const hue of [p.accent.fg, p.danger.fg]) {
        const band = composite(p.neutral[step] ?? p.neutral[0]!, hue, 0.06)
        expect(PaletteMath.contrastRatio(p.neutral[9]!, band), `muted on ${name}`).toBeGreaterThanOrEqual(4.5)
        expect(PaletteMath.contrastRatio(p.neutral[10]!, band), `ink on ${name}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('Inbox on a phone (round five P2)', () => {
  it('hides the page description so Start triage sits in the first row', () => {
    expect(panel).toMatch(/description=\{<span className="dshx:in-data-shell-phone-nav:hidden">\{t\('subtitle'\)\}<\/span>\}/u)
  })

  it('draws answer options as full-width 44 px rows with an 8 px radius, not 48 px pills', () => {
    expect(INBOX_CHIP).toContain('dshx:pointer-coarse:h-11')
    expect(INBOX_CHIP).toContain('dshx:pointer-coarse:rounded-lg')
    expect(INBOX_CHIP).not.toContain('rounded-full')
    const choices = row.slice(row.indexOf('item.choices.map('), row.indexOf('PROVIDER_VERBS.filter'))
    expect(choices).toContain('dshx:pointer-coarse:w-full')
    expect(choices).toContain('dshx:pointer-coarse:justify-start')
  })

  it('never clamps a question the card can answer', () => {
    const question = { verbs: ['Answer'], choices: [{ id: 'a', label: 'A' }] } as const
    expect(InboxView.clampsText(question, 'needs-you')).toBe(false)
    expect(InboxView.clampsText({ verbs: ['Done'], choices: [] }, 'needs-you')).toBe(true)
    expect(InboxView.clampsText(question, 'closed')).toBe(true)
    expect(row).toContain('InboxView.clampsText(item, props.view)')
  })
})
