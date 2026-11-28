import type { CSSProperties } from 'react'
import { cn } from '@dshfiles/plugin-ui/lib/utils'

/**
 * Account dots (council picker round 3, R9; shared from ai-accounts since round 5 so the fan-out chips draw them too). A dot tells accounts apart, so within one service the dots sit at least 60°
 * apart in hue, and each holds 3:1 against the selected wash in both schemes. No single colour reaches 3:1 on both the
 * light wash (OKLCH L 0.935) and the dark one (L 0.30), so a dot has a light and a dark value, swapped by the kit's
 * dark variant through two custom properties (`AccountDot`).
 */
export interface AccountAccent {
  readonly light: string
  readonly dark: string
  /** The dot's hue in degrees (OKLCH), for tests and the trigger. */
  readonly hue: number
}

/** Lightness and chroma per scheme: 4.5:1+ on the light wash, 6:1+ on the dark one (tests/account-identity.spec.ts). */
const DOT_LIGHT = { l: 0.52, c: 0.12 } as const
const DOT_DARK = { l: 0.76, c: 0.11 } as const

/** Hue steps for a service's accounts, in order: any two of the first six are at least 60° apart. */
const HUE_STEPS = [0, 120, 240, 60, 180, 300] as const

const HEX_COLOR = /^#[0-9a-f]{6}$/iu

const toLinear = (channel: number): number => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)

/** OKLCH hue of an sRGB hex colour. */
const hueOfHex = (hex: string): number => {
  const channel = (at: number): number => toLinear(Number.parseInt(hex.slice(at, at + 2), 16) / 255)
  const r = channel(1)
  const g = channel(3)
  const b = channel(5)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
}

/** Relative luminance (WCAG) of an OKLCH colour, clipped into sRGB as the browser draws it. */
const luminanceOfOklch = (input: { readonly l: number; readonly c: number; readonly h: number }): number => {
  const rad = (input.h * Math.PI) / 180
  const a = input.c * Math.cos(rad)
  const b = input.c * Math.sin(rad)
  const l = (input.l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (input.l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (input.l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl
}

const hashHue = (key: string): number => {
  let hash = 0
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) % 997
  return (hash * 37) % 360
}

const accentAt = (hue: number): AccountAccent => {
  const h = Math.round(((hue % 360) + 360) % 360)
  return {
    light: `oklch(${String(DOT_LIGHT.l)} ${String(DOT_LIGHT.c)} ${String(h)})`,
    dark: `oklch(${String(DOT_DARK.l)} ${String(DOT_DARK.c)} ${String(h)})`,
    hue: h,
  }
}

/** The dot of an account the picker has no profile for: a stable hue from its id. */
const accountColor = ({ instanceId, accentColor }: { readonly instanceId: string; readonly accentColor?: string | undefined }): AccountAccent =>
  accentAt(accentColor !== undefined && HEX_COLOR.test(accentColor) ? hueOfHex(accentColor) : hashHue(instanceId))

/**
 * Every account's dot. A service's first account keeps its accent's hue (AI Accounts' kind accent, or the user's), and
 * each later account of that service steps round the wheel (HUE_STEPS), so no two accounts of one service look alike.
 */
const accountAccents = (
  profiles: readonly { readonly instanceId: string; readonly kind: string; readonly accentColor?: string | undefined }[],
): ReadonlyMap<string, AccountAccent> => {
  const accents = new Map<string, AccountAccent>()
  const byKind = new Map<string, { readonly base: number; count: number }>()
  for (const profile of profiles) {
    let kind = byKind.get(profile.kind)
    if (kind === undefined) {
      kind = { base: accountColor({ instanceId: profile.kind, accentColor: profile.accentColor }).hue, count: 0 }
      byKind.set(profile.kind, kind)
    }
    const step = HUE_STEPS[kind.count % HUE_STEPS.length] ?? 0
    kind.count += 1
    accents.set(profile.instanceId, accentAt(kind.base + step + 30 * Math.floor((kind.count - 1) / HUE_STEPS.length)))
  }
  return accents
}

/** The picker's account dots (round 3 R9): one place for the rule and the colour maths its tests check. */
export class AccountColor {
  /** Dot lightness and chroma in light and dark. */
  static readonly LIGHT = DOT_LIGHT
  static readonly DARK = DOT_DARK
  /** Hue steps for a service's accounts. */
  static readonly HUE_STEPS = HUE_STEPS
  static readonly hueOfHex = hueOfHex
  static readonly luminanceOfOklch = luminanceOfOklch
  /** The dot of one account, from its accent or its id. */
  static readonly of = accountColor
  /** Every account's dot, a service's accounts spaced round the wheel. */
  static readonly accents = accountAccents
}

/** An account's dot, in its light or dark value by the scheme (round 3 R9). */
export const AccountDot = ({ accent, className }: { readonly accent: AccountAccent; readonly className?: string }) => {
  // The two values ride custom properties; the kit's dark variant picks one.
  const style: CSSProperties & Record<'--account-dot' | '--account-dot-dark', string> = { '--account-dot': accent.light, '--account-dot-dark': accent.dark }
  return (
    <i
      aria-hidden="true"
      className={cn('dshx:shrink-0 dshx:rounded-full dshx:bg-(--account-dot) dshx:dark:bg-(--account-dot-dark)', className)}
      data-account-dot
      style={style}
    />
  )
}
