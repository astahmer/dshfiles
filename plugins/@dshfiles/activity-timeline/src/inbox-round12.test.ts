import { readFileSync } from 'node:fs'
import { PaletteMath, WARM_STONE, type Oklch } from '@dshfiles/plugin-ui/theme/palette'
import { describe, expect, it } from 'vitest'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { InboxView } from './inbox-view.js'
import { INBOX_CHIP } from './triage-stage.js'

/** `colour` at `alpha` composited over `under`, as the browser paints a `bg-status-needs-you/12` fill (sRGB). */
const over = (colour: Oklch, alpha: number, under: Oklch): string => {
  const channels = (hex: string): number[] => [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16))
  const top = channels(PaletteMath.toHex(colour))
  const bottom = channels(PaletteMath.toHex(under))
  return `#${top.map((value, index) => Math.round(value * alpha + (bottom[index] ?? 0) * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`
}

const panel = readFileSync(new URL('./inbox-panel.tsx', import.meta.url), 'utf8')
const list = panel.slice(panel.indexOf('const triageable = '))
const answersRow = panel.slice(panel.indexOf('const answers = !answerable'), panel.indexOf('const evidence ='))
const writeOwn = answersRow.slice(answersRow.lastIndexOf('<Button', answersRow.indexOf('data-inbox-write-own=""')), answersRow.indexOf('</Button>', answersRow.indexOf('data-inbox-write-own=""')))

describe('the phone Inbox segmented control (council round 12 C3)', () => {
  it('spans the row in the phone shell, its segments growing from one basis', () => {
    const strip = '[&>[data-slot=page-container]>[data-slot=tabs]>[data-slot=page-tab-strip]'
    expect(list).toContain(`dshx:in-data-shell-phone-nav:${strip}>div]:w-full`)
    expect(list).toContain(`dshx:in-data-shell-phone-nav:${strip}_[data-slot=tabs-list]]:w-full`)
    expect(list).toContain(`dshx:in-data-shell-phone-nav:${strip}_[data-slot=tabs-trigger]]:flex-[1_1_0]`)
  })
})

describe('the phone Inbox fold (council round 12 C3)', () => {
  // Round 11 at 390×664: the failed card's head started 18px above the tab bar, its title under it. Together these
  // reclaim 16px (4 + 4 on the two card heads, 4 in the command block, 4 + 4 between the answers, less 4 under the
  // last one, which now draws an edge), so the failed card's title sits above the tab bar.
  it('draws a single-line card head 52px tall: 6px above and below its two lines (20 + 2 + 18)', () => {
    expect(InboxView.CARD_HEAD).toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-1.5')
    expect(InboxView.CARD_HEAD).not.toContain('dshx:@max-pane-narrow:[&>div:first-child]:py-2')
    // The 44pt seat keeps its place on the title's first line (8px above it), so ⋯ stays level with the title.
    expect(InboxView.HEAD_SEAT).toContain('dshx:@max-pane-narrow:-my-2!')
    expect(InboxView.HEAD_TWO_LINES).toContain('gap-y-0.5')
  })

  it('pads the command block 6px top and bottom', () => {
    expect(InboxView.RUNS_BLOCK).toContain('dshx:@max-pane-narrow:py-1.5')
    expect(InboxView.RUNS_BLOCK).not.toContain('py-2')
  })

  it('stacks the answers 4px apart and ends the card 4px under the last one, as Review ends the approval card', () => {
    expect(InboxView.ANSWERS).toContain('dshx:@max-pane-narrow:gap-y-1')
    expect(InboxView.ANSWERS).toContain('dshx:@max-pane-narrow:pb-1')
    expect(answersRow).toContain('InboxView.ANSWERS')
    expect(answersRow).not.toContain('pointer-coarse:pb-0')
  })
})

describe('"Write your own…" (council round 12 C3)', () => {
  it('takes the resting trigger look of the answers beside it, a full-width row on a touch screen', () => {
    expect(writeOwn).toContain('variant="field"')
    expect(writeOwn).not.toContain('variant="ghost"')
    expect(writeOwn).not.toContain('text-muted-foreground')
    expect(writeOwn).toContain('InboxView.ANSWER_ROW')
    const answer = answersRow.slice(answersRow.indexOf('item.choices.map('), answersRow.indexOf('data-inbox-recommended'))
    expect(answer).toContain('InboxView.ANSWER_ROW')
    expect(InboxView.ANSWER_ROW).toContain('dshx:pointer-coarse:w-full')
    expect(InboxView.ANSWER_ROW).toContain('dshx:pointer-coarse:min-h-11')
  })
})

describe('the two Review verbs on head bands (council round 12 C2)', () => {
  const verbs = panel.slice(panel.indexOf('const verbButtons = '), panel.indexOf('const headVerbs = '))
  const open = verbs.slice(verbs.indexOf('{openable && !answerable ? ('), verbs.indexOf('</Button>', verbs.indexOf('{openable && !answerable ? (')))

  it('draws an approval and a failed card head verb as the same tinted trigger, the band tint on both', () => {
    // Failed was red text on the red band; Needs you a 12% tint that vanished into its band.
    expect(InboxView.headVariant('failed')).toBe('danger-tint')
    expect(InboxView.headVariant('needs-you')).toBe('attention')
    expect(InboxView.onBand('failed')).toBe(true)
    expect(InboxView.onBand('needs-you')).toBe(true)
    expect(InboxView.onBand('ready')).toBe(false)
    expect(open).toContain("band={place === 'head' && InboxView.onBand(status)}")
    // 28px on a desktop; council round 14 C2 draws it 44pt on a touch screen (inbox-round14.test.ts).
    expect(cn(INBOX_CHIP, cn('dshx:shrink', InboxView.HEAD_VERB))).toContain('dshx:h-7')
    // One size and padding for both: the same chip, size and short-verb inset whatever the status.
    expect(open).toContain('className={cn(\'dshx:max-w-full\', INBOX_CHIP, size, shortLabel !== null && InboxView.SHORT_VERB)}')
  })
})

describe('"Recommended" (council round 12 C3)', () => {
  it('is a 12/400 secondary annotation 12px after the answer, which reads at 500', () => {
    expect(InboxView.ANSWER).toBe('dshx:font-medium')
    // The button's 6px gap plus 6px.
    expect(InboxView.RECOMMENDED).toBe('dshx:shrink-0 dshx:ml-1.5 dshx:text-xs dshx:font-normal dshx:text-muted-foreground')
    expect(panel).toContain('data-inbox-recommended="" className={InboxView.RECOMMENDED}')
    expect(panel).not.toContain('dshx:pointer-coarse:ml-auto')
  })

  it.each(['light', 'dark'] as const)('holds AA in secondary ink on the recommended answer\'s 12%% tint over the card (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    // The card is layer 1: the page step in light, the panel step in dark.
    const tint = over(p.accent.fg, 0.12, p.neutral[scheme === 'light' ? 0 : 1]!)
    expect(PaletteMath.contrastRatio(p.neutral[9]!, PaletteMath.hexToOklch(tint))).toBeGreaterThanOrEqual(4.5)
  })
})
