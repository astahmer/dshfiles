/**
 * The diff surfaces (round five A4): one recipe over the palette, used two ways. `style` is the CSS `PatchView` sets on
 * its root, written as `color-mix()` over the `--dshx-tone-*` steps, so a preset or a runtime theme repaints it where
 * the diff renders; `surfaces` computes the same colours from a generated palette, so tests and the syntax fit can
 * check contrast on them.
 *
 * - The body sits on the ramp: the page in light, the panel step in dark (never the library's near-black).
 * - Light: added and removed lines are a 16% tint of the success and danger tones over the body; a changed word inside
 *   them 34% (council round 11 A3: at 12% / 20% a changed word lifted only 1.08:1 off its line). `PatchLook` turns the
 *   library's light line mix off (`--mix-light: 0%`) as it does the dark one, so each override is exactly what paints.
 * - Dark (council round 7 A6): a 12% tint over the dark panel moved L by about 0.005 and barely separated from the
 *   page, so each band is its own step in the tone's hue. Council round 10 A4 calmed the line to L 0.25 at chroma 0.04
 *   and lifted a changed word clearly off it, to L 0.34 at 0.075 (it was 0.27 / 0.32); every syntax colour is fitted
 *   to 4.6:1 on both (theme-css.ts).
 *   `PatchLook` turns the library's dark mix off (`--mix-dark: 0%`), so the override is exactly what paints.
 * - Light text on the deeper tints (council round 11 A3): inside the diff only, punctuation and comments are capped at
 *   L 0.43 (4.6:1 on the 34% changed word; the secondary step sat at 3.4:1 there), and the +/− marks and line numbers
 *   are the tone pulled 25% toward the ink (6:1 on its 16% line). Syntax colours are fitted to every band (theme-css.ts).
 * - Line numbers take the same band.
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
const LINE_TINT = 0.16
const EMPHASIS_TINT = 0.34
const SEPARATOR_INK = 0.03
/** The light diff's ceiling for punctuation and comment lightness, and how far its +/− marks move toward the ink. */
const LIGHT_TEXT_CEILING = 0.43
const LIGHT_MARK_INK = 0.25
/** The dark line bands and changed-word fills (council round 7 A6, round 10 A4), in the success and danger hues. */
const DARK_BAND = { l: 0.25, c: 0.04 } as const
const DARK_EMPHASIS = { l: 0.34, c: 0.075 } as const

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
  const separator = mixOklab(body, ink, SEPARATOR_INK)
  if (p.scheme === 'dark')
    return {
      body,
      addition: { ...DARK_BAND, h: p.success.fg.h },
      deletion: { ...DARK_BAND, h: p.danger.fg.h },
      additionEmphasis: { ...DARK_EMPHASIS, h: p.success.fg.h },
      deletionEmphasis: { ...DARK_EMPHASIS, h: p.danger.fg.h },
      separator,
    }
  return {
    body,
    addition: mixOklab(body, p.success.fg, LINE_TINT),
    deletion: mixOklab(body, p.danger.fg, LINE_TINT),
    additionEmphasis: mixOklab(body, p.success.fg, EMPHASIS_TINT),
    deletionEmphasis: mixOklab(body, p.danger.fg, EMPHASIS_TINT),
    separator,
  }
}

const percent = (amount: number): string => `${String(Math.round(amount * 100))}%`

/**
 * The light diff's own text colours (council round 11 A3) as colours, for contrast checks; `style` writes the same
 * values relative to the theme. Dark keeps the transcript's tokens and the tones themselves.
 */
function text(p: Palette) {
  // SAFETY: the generated ramp has all eleven steps.
  const [faint, secondary, ink] = [p.neutral[8], p.neutral[9], p.neutral[10]] as [Oklch, Oklch, Oklch]
  const cap = (color: Oklch): Oklch => ({ ...color, l: Math.min(color.l, LIGHT_TEXT_CEILING) })
  return {
    punctuation: cap(secondary),
    comment: cap(faint),
    addition: mixOklab(p.success.fg, ink, LIGHT_MARK_INK),
    deletion: mixOklab(p.danger.fg, ink, LIGHT_MARK_INK),
  }
}

/** The `--diffs-*` and `--shiki-*` properties for one scheme; the library's shadow roots inherit custom properties. */
function style(scheme: Scheme) {
  const body = `var(--dshx-tone-${String(BODY_STEP[scheme])})`
  const tint = (tone: string, amount: number): string => `color-mix(in oklab, var(--dshx-tone-${tone}) ${percent(amount)}, ${body})`
  // PatchLook turns the library's line mix off in both schemes (`--mix-light` / `--mix-dark: 0%`), so the target is the
  // line itself: the tint in light, the band in dark in the tone's own hue so a preset's success and danger follow.
  const band = (tone: string, step: { readonly l: number; readonly c: number }): string => `oklch(from var(--dshx-tone-${tone}) ${String(step.l)} ${String(step.c)} h)`
  const target = (tone: string): string => (scheme === 'dark' ? band(tone, DARK_BAND) : tint(tone, LINE_TINT))
  const emphasis = (tone: string): string => (scheme === 'dark' ? band(tone, DARK_EMPHASIS) : tint(tone, EMPHASIS_TINT))
  const addition = target('success')
  const deletion = target('danger')
  // Light: the +/− marks and line numbers pulled toward the ink, punctuation and comments capped (see `text`).
  const mark = (tone: string): string =>
    scheme === 'dark' ? `var(--dshx-tone-${tone})` : `color-mix(in oklab, var(--dshx-tone-${tone}) ${percent(1 - LIGHT_MARK_INK)}, var(--dshx-tone-10))`
  const capped =
    scheme === 'dark'
      ? {}
      : {
          '--shiki-token-punctuation': `oklch(from var(--dshx-tone-9) min(l, ${String(LIGHT_TEXT_CEILING)}) c h)`,
          '--shiki-token-comment': `oklch(from var(--dshx-tone-8) min(l, ${String(LIGHT_TEXT_CEILING)}) c h)`,
        }
  return {
    ...capped,
    '--shiki-background': body,
    '--shiki-foreground': 'var(--dshx-tone-10)',
    '--diffs-bg-context-override': body,
    '--diffs-bg-context-gutter-override': body,
    '--diffs-bg-buffer-override': body,
    '--diffs-bg-addition-override': addition,
    '--diffs-bg-addition-number-override': addition,
    '--diffs-bg-deletion-override': deletion,
    '--diffs-bg-deletion-number-override': deletion,
    '--diffs-bg-addition-emphasis-override': emphasis('success'),
    '--diffs-bg-deletion-emphasis-override': emphasis('danger'),
    '--diffs-bg-separator-override': `color-mix(in oklab, var(--dshx-tone-10) ${percent(SEPARATOR_INK)}, ${body})`,
    '--diffs-addition-color-override': mark('success'),
    '--diffs-deletion-color-override': mark('danger'),
    '--diffs-modified-color-override': 'var(--dshx-tone-warning)',
  }
}

/** Diff surfaces as colours (for contrast) and as CSS (for `PatchView`). */
export class DiffLook {
  static readonly mixOklab = mixOklab
  static readonly surfaces = surfaces
  static readonly style = style
  static readonly text = text
}
