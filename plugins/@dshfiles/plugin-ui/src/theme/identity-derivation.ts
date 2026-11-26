/**
 * The identity palette of a theme that gives none (round eight, owner decision of 2026-11-26): six tones taken from
 * the theme's own colours, so a project, tag or agent colour matches it. Deterministic: the same theme always gives
 * the same six hex colours.
 *
 * 1. Candidates, in order: the syntax colours (keyword, function, string, constant, parameter), then accent and info.
 *    Greys (chroma under 0.04) are no hue and are skipped.
 * 2. Six distinct hues (30° apart, relaxed to 22° then 15° only when a theme has too few), preferring hues at least
 *    25° from the theme's danger, warning and success, so an identity never reads as a state. Where the theme's own
 *    colours run out, the default theme's identity hues fill in (then the hue farthest from every chosen and status
 *    hue), at the chroma the theme's candidates use.
 * 3. Each tone keeps its hue and chroma (less chroma only to stay inside sRGB) and moves its lightness away from the
 *    background only until it reads as text, 4.5:1, on bg, panel and raised: the rule the default tones were tuned to.
 * 4. The six are laid on the slots nearest the default hues (azure, olive, copper, violet, magenta, teal), so a slot
 *    keeps roughly its colour family from theme to theme.
 */
import type { IdentityTuple, SchemeTheme, SyntaxRole } from './theme-definition.ts'
import { IDENTITY_SLOT_COUNT } from './identity-palette.ts'
import { PaletteMath, type Oklch, type Scheme } from './palette.ts'
import { ReadabilityModel } from './readability.ts'

/** The default theme's identity hues, slot for slot (`--dshx-project-balanced-0..5` in styles.css). */
export const DEFAULT_IDENTITY_HUES = [225, 110, 55, 305, 340, 195] as const
/** A hue this close to danger, warning or success is avoided while another is free. */
export const STATUS_HUE_DISTANCE = 25
/** Text contrast every identity tone holds on bg, panel and raised. */
export const IDENTITY_TEXT_CONTRAST = 4.5

const SYNTAX_CANDIDATES: readonly SyntaxRole[] = ['keyword', 'function', 'string', 'constant', 'parameter']
const SEPARATIONS = [30, 22, 15] as const
const LAST_SEPARATION = 15
const GREY_CHROMA = 0.04
const DEFAULT_CHROMA = { light: 0.11, dark: 0.1 } as const
const DEFAULT_LIGHTNESS = { light: 0.5, dark: 0.78 } as const
const LIGHTNESS_STEP = 0.005
const CHROMA_STEP = 0.005

export const hueDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

const farFrom = (hue: number, others: readonly number[], distance: number): boolean => others.every(other => hueDistance(hue, other) >= distance)

/** The colours a derivation reads: a scheme's colours and, when it has them, its syntax colours. */
export type DerivationSource = Pick<SchemeTheme, 'colours' | 'syntax'>

/** The tone with less chroma until it is inside sRGB. */
function intoGamut(tone: Oklch): Oklch {
  let c = tone.c
  while (c > 0 && !PaletteMath.inGamut({ ...tone, c })) c = Math.max(0, c - CHROMA_STEP)
  return { ...tone, c }
}

/** Hex of the tone with its lightness moved away from the surfaces only until it reads as text on each of them. */
function fitToText(tone: Oklch, surfaces: readonly string[], scheme: Scheme): string {
  const rgbs = surfaces.map(ReadabilityModel.hexToRgb)
  const reads = (hex: string): boolean => rgbs.every(surface => ReadabilityModel.contrast(ReadabilityModel.hexToRgb(hex), surface) >= IDENTITY_TEXT_CONTRAST)
  const step = scheme === 'dark' ? LIGHTNESS_STEP : -LIGHTNESS_STEP
  let l = tone.l
  let hex = PaletteMath.toHex(intoGamut(tone))
  while (!reads(hex) && l > 0 && l < 1) {
    l = Math.min(1, Math.max(0, l + step))
    hex = PaletteMath.toHex(intoGamut({ ...tone, l }))
  }
  return hex
}

/** The synthetic hue to add: a free default hue, else the grid hue farthest from every chosen and status hue. */
function fillHue(chosen: readonly number[], status: readonly number[], separation: number, avoidStatus: boolean): number | undefined {
  const avoid = avoidStatus ? status : []
  const free = (hue: number) => farFrom(hue, chosen, separation) && farFrom(hue, avoid, STATUS_HUE_DISTANCE)
  const preset = DEFAULT_IDENTITY_HUES.find(free)
  if (preset !== undefined) return preset
  let best: number | undefined
  let bestGap = -1
  for (let hue = 0; hue < 360; hue += 5) {
    if (!free(hue)) continue
    const gap = Math.min(...[...chosen, ...avoid].map(other => hueDistance(hue, other)), 180)
    if (gap > bestGap) {
      best = hue
      bestGap = gap
    }
  }
  return best
}

/** The six tones, before fitting: theme colours first, then fill, under the passes in the header. */
function chooseTones(source: DerivationSource, scheme: Scheme): Oklch[] {
  const { colours } = source
  const status = [colours.danger, colours.warning, colours.success]
    .map(PaletteMath.hexToOklch)
    .filter(colour => colour.c >= GREY_CHROMA)
    .map(colour => colour.h)
  const candidates = [...SYNTAX_CANDIDATES.map(role => source.syntax?.[role]), colours.accent, colours.info]
    .filter(hex => hex !== undefined)
    .map(PaletteMath.hexToOklch)
    .filter(colour => colour.c >= GREY_CHROMA)
  const chroma =
    candidates.length === 0
      ? DEFAULT_CHROMA[scheme]
      : Math.min(
          0.16,
          Math.max(0.08, [...candidates.map(colour => colour.c)].sort((a, b) => a - b)[Math.floor(candidates.length / 2)] ?? DEFAULT_CHROMA[scheme]),
        )
  const chosen: Oklch[] = []
  const hues = () => chosen.map(tone => tone.h)
  const take = (separation: number, avoidStatus: boolean) => {
    for (const candidate of candidates) {
      if (chosen.length >= IDENTITY_SLOT_COUNT || chosen.includes(candidate)) continue
      if (farFrom(candidate.h, hues(), separation) && (!avoidStatus || farFrom(candidate.h, status, STATUS_HUE_DISTANCE))) chosen.push(candidate)
    }
  }
  const fill = (separation: number, avoidStatus: boolean) => {
    while (chosen.length < IDENTITY_SLOT_COUNT) {
      const hue = fillHue(hues(), status, separation, avoidStatus)
      if (hue === undefined) return
      chosen.push({ l: DEFAULT_LIGHTNESS[scheme], c: chroma, h: hue })
    }
  }
  for (const separation of SEPARATIONS) {
    take(separation, true)
    fill(separation, true)
  }
  take(LAST_SEPARATION, false)
  fill(0, false)
  return chosen.slice(0, IDENTITY_SLOT_COUNT)
}

/** Every order of `0..n-1` (720 for six slots). */
function permutations(n: number): number[][] {
  if (n === 0) return [[]]
  return permutations(n - 1).flatMap(rest => Array.from({ length: n }, (_, at) => [...rest.slice(0, at), n - 1, ...rest.slice(at)]))
}

/** The tones laid on the slots so their hues sit nearest the default slot hues (least total distance, first order on a tie). */
function onSlots(tones: readonly string[]): IdentityTuple {
  const hues = tones.map(hex => PaletteMath.hexToOklch(hex).h)
  let best: readonly number[] = [0, 1, 2, 3, 4, 5]
  let bestCost = Number.POSITIVE_INFINITY
  for (const order of permutations(IDENTITY_SLOT_COUNT)) {
    const cost = order.reduce((sum, tone, slot) => sum + hueDistance(hues[tone] ?? 0, DEFAULT_IDENTITY_HUES[slot] ?? 0), 0)
    if (cost < bestCost - 1e-9) {
      best = order
      bestCost = cost
    }
  }
  const at = (slot: number): string => tones[best[slot] ?? slot] ?? tones[0] ?? '#000000'
  return [at(0), at(1), at(2), at(3), at(4), at(5)]
}

/** The identity palette derived from a scheme's own colours (see the header). */
function derive(source: DerivationSource, scheme: Scheme): IdentityTuple {
  const surfaces = [source.colours.bg, source.colours.panel, source.colours.raised]
  return onSlots(chooseTones(source, scheme).map(tone => fitToText(tone, surfaces, scheme)))
}

/** The palette a scheme paints: its own `palette`, else the derived one. */
function paletteOf(theme: SchemeTheme, scheme: Scheme): IdentityTuple {
  return theme.palette ?? derive(theme, scheme)
}

/** Identity palettes for themes: derivation and the palette in effect. */
export class IdentityDerivation {
  static readonly derive = derive
  static readonly paletteOf = paletteOf
}
