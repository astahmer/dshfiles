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
  /** Hue of the accent (Needs you, the focus ring, links). */
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
  /**
   * The selection fill (round five K2): the selected list row, the settings category, a pressed toggle, the palette's
   * highlighted row, a chosen card. Neutral since council round 3 (A1): a warm grey step with no accent hue, so indigo
   * fills mean attention only and the attention washes outrank it by colour. Text on it stays ink; a list row adds the
   * `selected-marker` bar (ink since council round 6 A1) and a card the `selected-card` edge and check.
   */
  readonly selectedWash: Oklch
  /**
   * The selected edge (council round 12 A1): a neutral 1px inset edge on top of the wash, for a selected row that leads
   * with a glyph, tile or mark and so draws no `selected-marker` pill (`dshx:selected-edge`). 3:1 against the wash on the
   * page, the nav column and a dialog (dark dialogs lift the wash to L 0.30): light oklch(0.61 0.01 65) #88827D (the
   * council's #A39B93 held 2.26:1), dark oklch(0.58 0.01 65) #7F7974 (the council's #817A73 within one step).
   */
  readonly selectedEdge: Oklch
  /**
   * Attention at the tint rung (round five A2): the persistent wash of a Needs-you row (accent hue) and of a Failed row
   * (danger hue). Opaque and stronger than `selectedWash`, so what waits on you outranks what you selected.
   */
  readonly needsYouWash: Oklch
  /**
   * The Needs-you wash for a full-width band (council round 3 A2): an Inbox card's head band spans the list, so in dark
   * it drops to chroma 0.035 where a row keeps 0.045. Light is already at the gamut edge and the band equals the row wash.
   */
  readonly needsYouBandWash: Oklch
  readonly failedWash: Oklch
  /**
   * A field's boundary (council round 6 A2, WCAG 1.4.11): the edge of an input, select, textarea, checkbox or radio,
   * 3:1 against bg, panel, raised, the dark nav column and the dark dialog fill. Light about #88827D, dark #76706C,
   * with the primary's warmth. Dividers and card hairlines keep the subtle border steps (4 and 5).
   */
  readonly fieldBorder: Oklch
  /**
   * A quiet trigger's fill (council round 10 A1): a select, combobox or value-picker trigger (`Button variant="field"`)
   * is a filled chip with no edge at rest, so a filter row stops reading as wireframe; the 3:1 `fieldBorder` edge shows
   * on hover and while open. Text-entry fields keep the edge at rest. The ink at 5% (5.2% dark), so it paints the
   * council's oklch(0.955 0.004 65) light and oklch(0.235 0.006 65) dark on the page and stays one step off every other
   * surface it sits on (the light nav column at 0.962 would swallow an opaque 0.955; a dark dialog at 0.27 would sink it).
   */
  readonly triggerFill: Oklch
  /**
   * The selected segment (council round 10 A3), one rule for the kit's segmented Tabs, the page's sliding tab indicator
   * and `SlidingSegments`: paper on the raised track in light (#FEFCFA on #EBE9E7), a raised #302C28 on the #23201D track
   * in dark, inset 3px at a 6px radius under a 550 ink label.
   */
  readonly segmentThumb: Oklch
  /** The selected segment's quiet 1px edge: the ink at 10% in light, white at 7% in dark. */
  readonly segmentEdge: Oklch
  /**
   * The user prompt bubble (council round 6 A5): a faint cool tint at hue 230, 40° from the default attention indigo,
   * so your own words read apart from the agent's without saying attention. Ink, secondary and faint text and links hold
   * AA on it. Fixed hue: a prompt is neither the accent nor a status.
   */
  readonly promptFill: Oklch
  /**
   * The navigation column (council round 6 A4): the thread list, the Settings categories, a master list, the Host
   * sidebar. Light keeps the panel step; dark lifts it from the panel's 0.21 to oklch(0.225 0.006 60), so column and
   * page separate without relying on a hairline. Every text role holds AA on it (tests/surface-roles).
   */
  readonly navSurface: Oklch
  /**
   * The Ready dot (council round 6 A6): in light a lighter green than the status text (L 0.55, chroma 0.13) so the dot is
   * not the heaviest mark in a list; 3:1 on bg, panel, raised, nav and the selection wash. Dark keeps the success tone.
   */
  readonly readyMark: Oklch
  /**
   * The primary button's fill: in light a soft warm near-black (council round 4 A2: oklch 0.30 0.01 on the grey hue, a
   * step off the 0.22 ink so it is not a black slab); in dark a softened warm light grey (council round 3 A3: oklch 0.88
   * 0.006), so the one primary stops being the brightest thing on the screen. Its label is the page colour, AA at rest
   * and on hover.
   */
  readonly primaryFill: Oklch
  /** The primary's hover: darker in light (L 0.24), 86% of the fill toward the page in dark. */
  readonly primaryHover: Oklch
}

export const NEUTRAL_STEP_NAMES = ['bg', 'panel', 'raised', 'selected', 'line', 'border', 'border-strong', 'strong', 'faint', 'muted', 'text'] as const

/**
 * Lightness per step at contrast 1. Steps 0–3 are fills, 4–6 borders, 7–8 strong, 9–10 text. Round five (K1) widened
 * the surface steps, mostly in dark, so panel and raised read apart from the page, and softened the dark ink. Faint text
 * (step 8) reads at AA on bg, panel, raised and every row wash in both schemes (round five A3).
 */
const LIGHTNESS = {
  dark: [0.185, 0.21, 0.245, 0.27, 0.295, 0.335, 0.37, 0.45, 0.66, 0.72, 0.93],
  light: [0.992, 0.962, 0.935, 0.915, 0.895, 0.87, 0.8, 0.7, 0.52, 0.5, 0.22],
} as const satisfies Record<Scheme, readonly number[]>

const STATUS_HUES = { success: 150, warning: 80, danger: 25 } as const

/**
 * The quiet trigger's ink share (council round 10 A1): over the page it paints L 0.959 light, 0.233 dark (the council's
 * 0.955 / 0.235 within one 8-bit step), and secondary text holds AA on it over every surface up to the selection wash.
 */
const TRIGGER_FILL_ALPHA = { light: 0.05, dark: 0.052 } as const

/** Where the selected edge starts before it is fitted to 3:1 on the wash (council round 12 A1). */
const SELECTED_EDGE_L = { light: 0.61, dark: 0.58 } as const

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
  // SAFETY: `neutral` maps LIGHTNESS, whose ramps have all eleven steps, so steps 0, 1 and 2 exist.
  const [bg, panel, raised] = neutral as [Oklch, Oklch, Oklch]
  // The light primary's warmth: 0.01 for warm stone (grey chroma 0.007), none for a neutral preset.
  const primaryChroma = round(chroma / 0.7, 4)
  const selectedWash: Oklch = dark ? { l: 0.275, c: 0.006, h: 60 } : { l: 0.935, c: 0.004, h: 80 }
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
    // Neutral (council round 3 A1): the fill carries no hue; the row marker is ink (council round 6 A1).
    selectedWash,
    selectedEdge: fitSelectedEdge({ l: round(clamp(base + (SELECTED_EDGE_L[scheme] - base) * contrast, 0, 1), 4), c: 0.01, h: hue }, selectedWash, dark),
    // Light washes sit on the sRGB edge (council round 5 A8): at L 0.94 a 0.035 blue clipped to 0.029, so each light
    // wash takes the lowest L where faint text still holds AA and the most chroma that L renders unclipped.
    needsYouWash: dark ? { l: 0.29, c: 0.045, h: accentHue } : { l: 0.935, c: 0.032, h: accentHue },
    needsYouBandWash: dark ? { l: 0.29, c: 0.035, h: accentHue } : { l: 0.935, c: 0.032, h: accentHue },
    // Dark Failed is darker and calmer (council round 3 A2), so a red row does not glow beside a Needs-you one.
    failedWash: dark ? { l: 0.255, c: 0.032, h: STATUS_HUES.danger } : { l: 0.94, c: 0.031, h: STATUS_HUES.danger },
    readyMark: dark ? status(STATUS_HUES.success) : { l: 0.55, c: 0.13, h: STATUS_HUES.success },
    navSurface: dark ? { l: 0.225, c: 0.006, h: 60 } : panel,
    promptFill: dark ? { l: 0.255, c: 0.018, h: 230 } : { l: 0.965, c: 0.012, h: 230 },
    fieldBorder: { l: round(clamp(base + ((dark ? 0.55 : 0.61) - base) * contrast, 0, 1), 4), c: primaryChroma, h: hue },
    triggerFill: withAlpha(neutral[10] ?? { l: dark ? 0.93 : 0.22, c: 0, h: hue }, TRIGGER_FILL_ALPHA[scheme]),
    segmentThumb: dark ? { l: 0.296, c: round((chroma * 9) / 7, 4), h: hue } : bg,
    segmentEdge: dark ? { l: 1, c: 0, h: 0, alpha: 0.07 } : withAlpha(neutral[10] ?? { l: 0.22, c: 0, h: hue }, 0.1),
    primaryFill: dark ? { l: 0.88, c: 0.006, h: hue } : { l: 0.3, c: primaryChroma, h: hue },
    primaryHover: dark
      ? { l: round(0.88 * 0.86 + bg.l * 0.14, 4), c: round(0.006 * 0.86 + bg.c * 0.14, 4), h: hue }
      : { l: 0.24, c: primaryChroma, h: hue },
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

/**
 * Moves the selected edge away from the wash until it holds 3:1 on it wherever it is painted: the page and the nav column
 * share the opaque wash; a dark dialog lifts it to L 0.30 (surfaces.css). The warm-stone default already passes.
 */
function fitSelectedEdge(edge: Oklch, wash: Oklch, dark: boolean): Oklch {
  const under = dark ? [wash, { ...wash, l: Math.max(wash.l, 0.3) }] : [wash]
  let fitted = edge
  for (let i = 0; i < 40 && Math.min(...under.map(back => contrastRatio(fitted, back))) < 3.05; i += 1) fitted = { ...fitted, l: round(fitted.l + (dark ? 0.01 : -0.01), 4) }
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
