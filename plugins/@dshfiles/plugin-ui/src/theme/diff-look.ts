/**
 * The diff surfaces (round five A4): one recipe over the palette, used two ways. `style` is the CSS `PatchView` sets on
 * its root, written as `color-mix()` over the `--dshx-tone-*` steps, so a preset or a runtime theme repaints it where
 * the diff renders; `surfaces` computes the same colours from a generated palette, so tests and the syntax fit can
 * check contrast on them.
 *
 * - The body sits on the ramp: the page in light, the panel step in dark (never the library's near-black).
 * - Added and removed lines are a 12% tint of the success and danger tones over the body; a changed word inside them
 *   20%. Line numbers take the same band. The library mixes its line override into the body itself (12% in light, 20%
 *   in dark), so the override is the colour whose mix lands at 12%: the tone in light, a 60% mix of it in dark.
 * - The collapsed-lines bar is a 3% ink wash: a quiet band, not a grey slab.
 */
// Type-only, as `.js`: `PatchView` imports this file, and plugins that compile it reject `.ts` import paths.
import type { Oklch, Palette, Scheme } from './palette.js'

const round = (value: number, digits: number): number => Number(value.toFixed(digits))

/**
 * CSS `color-mix(in oklab, over amount, base)` for two opaque colours, returned in oklch: what the browser paints for a
 * tint written as a mix over a surface, so tests can check contrast on it.
 */
function mixOklab(base: Oklch, over: Oklch, amount: number): Oklch {
  const lab = ({ l, c, h }: Oklch): readonly [number, number, number] => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)]
  const [bl, ba, bb] = lab(base)
  const [ol, oa, ob] = lab(over)
  const [l, a, b] = [bl + (ol - bl) * amount, ba + (oa - ba) * amount, bb + (ob - bb) * amount]
  const h = (Math.atan2(b, a) * 180) / Math.PI
  return { l: round(l, 4), c: round(Math.hypot(a, b), 4), h: round(h < 0 ? h + 360 : h, 2) }
}

const BODY_STEP = { light: 0, dark: 1 } as const satisfies Record<Scheme, number>
const LINE_TINT = 0.12
const EMPHASIS_TINT = 0.2
const SEPARATOR_INK = 0.03
/** How much of a line override `@pierre/diffs` mixes into the body (`--mix-light` 88%, `--mix-dark` 80%). */
const LIBRARY_LINE_MIX = { light: 0.12, dark: 0.2 } as const satisfies Record<Scheme, number>

export interface DiffSurfaces {
  readonly body: Oklch
  readonly addition: Oklch
  readonly deletion: Oklch
  readonly additionEmphasis: Oklch
  readonly deletionEmphasis: Oklch
  readonly separator: Oklch
}

function surfaces(p: Palette): DiffSurfaces {
  // SAFETY: the generated ramp has all eleven steps; BODY_STEP (0 or 1) and 10 are below eleven.
  const [body, ink] = [p.neutral[BODY_STEP[p.scheme]], p.neutral[10]] as [Oklch, Oklch]
  return {
    body,
    addition: mixOklab(body, p.success.fg, LINE_TINT),
    deletion: mixOklab(body, p.danger.fg, LINE_TINT),
    additionEmphasis: mixOklab(body, p.success.fg, EMPHASIS_TINT),
    deletionEmphasis: mixOklab(body, p.danger.fg, EMPHASIS_TINT),
    separator: mixOklab(body, ink, SEPARATOR_INK),
  }
}

const percent = (amount: number): string => `${String(Math.round(amount * 100))}%`

/** The `--diffs-*` and `--shiki-*` properties for one scheme; the library's shadow roots inherit custom properties. */
function style(scheme: Scheme) {
  const body = `var(--dshx-tone-${String(BODY_STEP[scheme])})`
  const tint = (tone: string, amount: number): string => `color-mix(in oklab, var(--dshx-tone-${tone}) ${percent(amount)}, ${body})`
  // The library mixes this target into the body at its own amount; aim it so the line lands at LINE_TINT.
  const target = (tone: string): string => {
    const amount = LINE_TINT / LIBRARY_LINE_MIX[scheme]
    return amount >= 1 ? `var(--dshx-tone-${tone})` : tint(tone, amount)
  }
  const addition = target('success')
  const deletion = target('danger')
  return {
    '--shiki-background': body,
    '--shiki-foreground': 'var(--dshx-tone-10)',
    '--diffs-bg-context-override': body,
    '--diffs-bg-context-gutter-override': body,
    '--diffs-bg-buffer-override': body,
    '--diffs-bg-addition-override': addition,
    '--diffs-bg-addition-number-override': addition,
    '--diffs-bg-deletion-override': deletion,
    '--diffs-bg-deletion-number-override': deletion,
    '--diffs-bg-addition-emphasis-override': tint('success', EMPHASIS_TINT),
    '--diffs-bg-deletion-emphasis-override': tint('danger', EMPHASIS_TINT),
    '--diffs-bg-separator-override': `color-mix(in oklab, var(--dshx-tone-10) ${percent(SEPARATOR_INK)}, ${body})`,
    '--diffs-addition-color-override': 'var(--dshx-tone-success)',
    '--diffs-deletion-color-override': 'var(--dshx-tone-danger)',
    '--diffs-modified-color-override': 'var(--dshx-tone-warning)',
  }
}

/** Diff surfaces as colours (for contrast) and as CSS (for `PatchView`). */
export class DiffLook {
  static readonly mixOklab = mixOklab
  static readonly surfaces = surfaces
  static readonly style = style
}
