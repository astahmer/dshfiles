/**
 * Palette generator for the visual refresh (visual refresh, D1): every neutral, the accent and the status
 * colours come from a few numbers in oklch, so light, dark and later presets (P6) share one code path instead of
 * hand-picked hex. Pure functions only; `scripts/emit-theme-css.ts` turns the result into the static CSS block
 * `@dshfiles/ui-styles` injects. The colour maths is ported from the visual refresh tone and font prototype.
 */

export type Scheme = 'light' | 'dark'

export interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
  readonly alpha?: number
}

export interface PaletteInput {
  /** Hue of the greys; 65 is warm stone. */
  readonly hue: number
  /** Chroma of dark-scheme fills and borders; text gets 5/7 of it and light mode half of both (D1). */
  readonly chroma: number
  /** Hue of the accent (focus, selection, Needs you). */
  readonly accentHue: number
  /** 1 is the standard spread; above 1 pushes borders and text away from the background (high contrast). */
  readonly contrast: number
  readonly scheme: Scheme
}

/** A status colour: text/icon colour, a 12% tint for fills, a 30% tint for borders. */
export interface Trio {
  readonly fg: Oklch
  readonly bg: Oklch
  readonly border: Oklch
}

export interface Palette {
  readonly scheme: Scheme
  /**
   * The 11 neutral steps, each with one job: 0 app background; fills 1 panel, 2 raised/hover, 3 selected;
   * borders 4 hairline, 5 control, 6 strong; 7 solid low (idle glyphs, scrollbars), 8 faint (tertiary, placeholder);
   * text 9 secondary, 10 primary.
   */
  readonly neutral: readonly Oklch[]
  readonly accent: Trio & { readonly onSolid: Oklch }
  readonly success: Trio
  readonly warning: Trio
  readonly danger: Trio
  readonly info: Trio
}

export const NEUTRAL_STEP_NAMES = ['bg', 'panel', 'raised', 'selected', 'line', 'border', 'border-strong', 'strong', 'faint', 'muted', 'text'] as const

/** Lightness per step at contrast 1. Steps 0–3 are fills, 4–6 borders, 7–8 strong, 9–10 text. */
const LIGHTNESS = {
  dark: [0.165, 0.19, 0.225, 0.25, 0.27, 0.31, 0.37, 0.45, 0.6, 0.72, 0.955],
  light: [0.992, 0.972, 0.945, 0.925, 0.905, 0.87, 0.8, 0.7, 0.6, 0.5, 0.22],
} as const satisfies Record<Scheme, readonly number[]>

const STATUS_HUES = { success: 150, warning: 80, danger: 25 } as const

/** Default warm-stone input (D1). */
export const WARM_STONE = { hue: 65, chroma: 0.007, accentHue: 270, contrast: 1 } as const

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number, digits: number) => Number(value.toFixed(digits))

/** Chroma of fills/borders and of text for one scheme. */
export interface NeutralChroma {
  readonly fill: number
  readonly text: number
}

/** Chroma of fills/borders and of text for one scheme: light mode is half as warm as dark (D1). */
function neutralChroma(chroma: number, scheme: Scheme): NeutralChroma {
  const scale = scheme === 'light' ? 0.5 : 1
  return { fill: chroma * scale, text: ((chroma * 5) / 7) * scale }
}

const withAlpha = (color: Oklch, alpha: number): Oklch => ({ ...color, alpha })

function trio(fg: Oklch): Trio {
  return { fg, bg: withAlpha(fg, 0.12), border: withAlpha(fg, 0.3) }
}

function palette(input: PaletteInput): Palette {
  const { hue, chroma, accentHue, contrast, scheme } = input
  const lightness: readonly number[] = LIGHTNESS[scheme]
  const base = lightness[0] ?? 0
  const tint = neutralChroma(chroma, scheme)
  const neutral = lightness.map((l, step): Oklch => {
    const spread = step >= 4 ? clamp(base + (l - base) * contrast, 0, 1) : l
    return { l: round(spread, 4), c: round(step >= 7 ? tint.text : tint.fill, 4), h: hue }
  })
  const dark = scheme === 'dark'
  // SAFETY: `neutral` maps LIGHTNESS, whose ramps have all eleven steps, so steps 0 and 2 exist.
  const [bg, , raised] = neutral as [Oklch, Oklch, Oklch]
  const accentFg = fitAccent(dark ? { l: 0.72, c: 0.14, h: accentHue } : { l: 0.53, c: 0.19, h: accentHue - 2 }, raised, dark)
  const status = (h: number): Oklch => (dark ? { l: 0.75, c: 0.14, h } : { l: 0.5, c: 0.15, h })
  return {
    scheme,
    neutral,
    accent: { ...trio(accentFg), onSolid: dark ? bg : { l: 0.99, c: 0, h: accentHue } },
    success: trio(status(STATUS_HUES.success)),
    // Amber needs a darker step than green or red to keep AA on a light background.
    warning: trio(dark ? status(STATUS_HUES.warning) : { l: 0.48, c: 0.12, h: STATUS_HUES.warning }),
    danger: trio(status(STATUS_HUES.danger)),
    info: trio(accentFg),
  }
}

/**
 * Moves the accent away from the raised fill (the closest of the three surfaces) until it reads as AA text: yellow,
 * green and teal hues are much lighter than indigo at the same oklch lightness. Indigo, the default, already passes
 * and is returned unchanged.
 */
function fitAccent(accent: Oklch, raised: Oklch, dark: boolean): Oklch {
  let fitted = accent
  for (let i = 0; i < 40 && contrastRatio(fitted, raised) < 4.6; i += 1) fitted = { ...fitted, l: round(fitted.l + (dark ? 0.01 : -0.01), 4) }
  return fitted
}

/** oklch → linear sRGB, unclamped. */
function toLinearSrgb({ l, c, h }: Oklch): readonly [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.291485548 * b
  const L = l_ ** 3
  const M = m_ ** 3
  const S = s_ ** 3
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ]
}

const encode = (x: number) => {
  const v = clamp(x, 0, 1)
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
}
const decode = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)

/** sRGB hex (alpha dropped), gamut-clipped. For review tables and tests. */
function toHex(color: Oklch): string {
  return `#${toLinearSrgb(color)
    .map(x =>
      Math.round(encode(x) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** Parse `#rgb`/`#rrggbb` into oklch. */
function hexToOklch(hex: string): Oklch {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? [...raw].map(ch => ch + ch).join('') : raw.slice(0, 6)
  const channel = (start: number): number => decode(Number.parseInt(full.slice(start, start + 2), 16) / 255)
  const [r, g, b] = [channel(0), channel(2), channel(4)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h }
}

/** WCAG 2 relative luminance of an opaque colour after gamut clipping. */
function luminance(color: Oklch): number {
  const clip = (x: number): number => decode(encode(x))
  const [r, g, b] = toLinearSrgb(color)
  return 0.2126 * clip(r) + 0.7152 * clip(g) + 0.0722 * clip(b)
}

/** WCAG 2 contrast ratio between two opaque colours. */
function contrastRatio(a: Oklch, b: Oklch): number {
  const [first, second] = [luminance(a), luminance(b)]
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** CSS `oklch()` text. */
function toCss({ l, c, h, alpha }: Oklch): string {
  const body = `${round(l, 4)} ${round(c, 4)} ${round(h, 2)}`
  return alpha === undefined ? `oklch(${body})` : `oklch(${body} / ${round(alpha, 3)})`
}

/** The palette roles a standalone page needs, as sRGB hex. */
export interface StandaloneColours {
  readonly bg: string
  readonly panel: string
  readonly raised: string
  readonly line: string
  readonly faint: string
  readonly muted: string
  readonly text: string
  readonly accent: string
  readonly accentBg: string
  readonly success: string
  readonly warning: string
  readonly danger: string
}

/**
 * The default palette as hex for a page that cannot read the Host variables: a sandboxed iframe with no same-origin
 * access, or an exported HTML file opened outside DSH. Generated, so those pages follow the same warm stone and accent
 * as the app instead of restating hand-picked hex (visual refresh T4.2).
 */
function standaloneColours(scheme: Scheme): StandaloneColours {
  const generated = palette({ ...WARM_STONE, scheme })
  // SAFETY: the generated ramp has all eleven steps, and every index read here is below eleven.
  const [bg, panel, raised, , line, , , , faint, muted, text] = generated.neutral as [
    Oklch,
    Oklch,
    Oklch,
    Oklch,
    Oklch,
    Oklch,
    Oklch,
    Oklch,
    Oklch,
    Oklch,
    Oklch,
  ]
  return {
    bg: toHex(bg),
    panel: toHex(panel),
    raised: toHex(raised),
    line: toHex(line),
    faint: toHex(faint),
    muted: toHex(muted),
    text: toHex(text),
    accent: toHex(generated.accent.fg),
    // An opaque 12% accent wash over the background, for a highlighted card (hex has no alpha in older engines).
    accentBg: toHex(mix(bg, generated.accent.fg, 0.12)),
    success: toHex(generated.success.fg),
    warning: toHex(generated.warning.fg),
    danger: toHex(generated.danger.fg),
  }
}

const mix = (base: Oklch, over: Oklch, amount: number): Oklch => ({
  l: base.l + (over.l - base.l) * amount,
  c: base.c + (over.c - base.c) * amount,
  h: over.h,
})

/** Colour arithmetic and the generated neutral and accent ramps. */
export class PaletteMath {
  static readonly neutralChroma = neutralChroma
  static readonly palette = palette
  static readonly toHex = toHex
  static readonly hexToOklch = hexToOklch
  static readonly luminance = luminance
  static readonly contrastRatio = contrastRatio
  static readonly toCss = toCss
  static readonly standaloneColours = standaloneColours
}
