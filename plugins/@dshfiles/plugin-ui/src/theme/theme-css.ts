/**
 * Emits the static theme block `@dshfiles/ui-styles` injects (visual refresh T0.2). It is unlayered global CSS
 * that out-ranks the Host theme sheet (`@deepseek-ai/dsh-client-ui-theme` 0.2.1-rc.2) by specificity, not by order:
 *
 * - Host colours are declared on `body` and `body[data-ds-dark-theme]`, so light goes on `html body` (0,0,2) and dark
 *   on `body[data-ds-dark-theme][data-ds-dark-theme]` (0,2,1). Light still loses to the Host dark block, so the
 *   Host's own dark values never leak into light and ours always win in dark.
 * - Host radii and default font stacks are declared on `:root`, so they go on `:root:root`.
 * - Font *sizes* are never touched: Settings › Font size writes `--dsh-*-font-size` on `body` and must keep working.
 *   Font *families* go through the Host's `-default` stacks, so a family typed in Settings still wins.
 *
 * Two layers: the Host's static neutral ramps are re-tinted to the palette hue at their own lightness (every native
 * surface turns warm at once), then the aliases with a clear job are pinned to the 11 palette steps. Regenerate with
 * `node plugins/@dshfiles/plugin-ui/scripts/emit-theme-css.ts`; a ui-styles test fails when the file drifts.
 */
import { hexToOklch, NEUTRAL_STEP_NAMES, palette, toCss, WARM_STONE, type Oklch, type Palette, type PaletteInput, type Scheme } from './palette.ts'

export const LIGHT_SELECTOR = 'html body'
export const DARK_SELECTOR = 'body[data-ds-dark-theme][data-ds-dark-theme]'

/** Host radius scale remapped onto the one kit scale: 4 chips · 6 controls · 8 cards · 12 composer/menus · 16 sheets. */
export const HOST_RADII = { xs: 4, sm: 6, md: 8, lg: 12, xl: 12, panel: 16 } as const

/** The Host static neutral ramps (0.2.1-rc.2 values), re-tinted at their own lightness. */
export const HOST_NEUTRAL_RAMPS: Readonly<Record<string, string>> = {
  'neutral-00': '#ffffff',
  'neutral-50': '#fafafa',
  'neutral-100': '#f5f5f5',
  'neutral-150': '#ededed',
  'neutral-200': '#e5e5e5',
  'neutral-250': '#dcdcdc',
  'neutral-300': '#d4d4d4',
  'neutral-400': '#a2a4a6',
  'neutral-500': '#7f8287',
  'neutral-550': '#65676b',
  'neutral-600': '#545557',
  'neutral-700': '#3c3c3d',
  'neutral-800': '#292929',
  'neutral-850': '#212123',
  'neutral-900': '#0f0f0f',
  'neutral-1000': '#000000',
  'neutral-bluish-00': '#ffffff',
  'neutral-bluish-50': '#f9fafb',
  'neutral-bluish-60': '#f5f6f7',
  'neutral-bluish-75': '#f1f3f5',
  'neutral-bluish-100': '#ebeef2',
  'neutral-bluish-150': '#e9ecf2',
  'neutral-bluish-200': '#e1e5ee',
  'neutral-bluish-300': '#cfd3d6',
  'neutral-bluish-400': '#adb2b8',
  'neutral-bluish-500': '#979da6',
  'neutral-bluish-600': '#81858c',
  'neutral-bluish-700': '#61666b',
  'neutral-bluish-750': '#43454a',
  'neutral-bluish-800': '#353638',
  'neutral-bluish-850': '#2c2c2e',
  'neutral-bluish-875': '#232324',
  'neutral-bluish-900': '#1b1b1c',
  'neutral-bluish-950': '#151517',
  'neutral-bluish-1000': '#0f1115',
}

/** The Host brand ramp, moved onto the accent hue at its own lightness and chroma. */
export const HOST_BRAND_RAMP: Readonly<Record<string, string>> = {
  'deepseek-50': '#edf3fe',
  'deepseek-100': '#e4edfd',
  'deepseek-200': '#d3e2ff',
  'deepseek-300': '#b7c8fe',
  'deepseek-400': '#7aaaff',
  'deepseek-450': '#5686fe',
  'deepseek-500': '#4176e6',
  'deepseek-600': '#4868b2',
  'deepseek-800': '#34415b',
  'deepseek-900': '#283142',
}

type Ref = number | string
type AliasRow = readonly [name: string, light: Ref, dark: Ref]

const tone = (step: number) => `var(--dshx-tone-${step})`
const mixText = (percent: number) => `color-mix(in oklch, var(--dshx-tone-10) ${percent}%, transparent)`

/**
 * Host aliases with a clear job, pinned to palette steps (a number) or a token. Everything else follows the
 * re-tinted static ramps. Borders are solid hairlines (steps 4–6) instead of black/white alpha.
 */
export const HOST_ALIASES: readonly AliasRow[] = [
  ['--dsw-alias-bg-base', 0, 0],
  ['--dsw-alias-bg-document-preview', 1, 1],
  ['--dsw-alias-label-document-preview', 9, 9],
  ['--dsw-alias-bg-layer-1', 0, 1],
  ['--dsw-alias-bg-layer-2', 0, 2],
  ['--dsw-alias-bg-layer-3', 0, 3],
  ['--dsw-alias-bg-module-platform', 2, 2],
  ['--dsw-alias-bg-multi-select', 2, 2],
  ['--dsw-alias-border-l1', 3, 3],
  ['--dsw-alias-border-l2', 4, 4],
  ['--dsw-alias-border-l2-darkmode-thin', 4, 4],
  ['--dsw-alias-border-l3', 5, 5],
  ['--dsw-alias-border-l4', 6, 6],
  ['--dsw-alias-brand-primary', 10, 10],
  ['--dsw-alias-brand-primary-invert', 0, 0],
  ['--dsw-alias-brand-text', 10, 10],
  ['--dsw-alias-brand-primary-new-colorprimary-new-color', 'var(--dshx-tone-accent)', 'var(--dshx-tone-accent)'],
  [
    '--dsw-alias-button-primary-hover',
    'color-mix(in oklch, var(--dshx-tone-10) 86%, var(--dshx-tone-0))',
    'color-mix(in oklch, var(--dshx-tone-10) 86%, var(--dshx-tone-0))',
  ],
  ['--dsw-alias-interactive-bg-hover', mixText(6), mixText(7)],
  ['--dsw-alias-interactive-bg-active', mixText(10), mixText(12)],
  ['--dsw-alias-interactive-bg-hover-accent', mixText(14), mixText(20)],
  ['--dsw-alias-interactive-bg-hover-solid', 2, 2],
  ['--dsw-alias-interactive-bg-hover-danger', 'var(--dshx-tone-danger-bg)', 'var(--dshx-tone-danger-bg)'],
  ['--dsw-alias-label-primary', 10, 10],
  ['--dsw-alias-label-primary-foreground', 0, 0],
  ['--dsw-alias-label-primary-inverted', 0, 0],
  ['--dsw-alias-label-secondary', 9, 9],
  ['--dsw-alias-label-tertiary', 8, 8],
  ['--dsw-alias-label-caption', 8, 8],
  ['--dsw-alias-link', 'var(--dshx-tone-accent)', 'var(--dshx-tone-accent)'],
  ['--dsw-alias-markdown-code-block', 1, 1],
  ['--dsw-alias-markdown-code-block-banner', 2, 2],
  ['--dsw-alias-markdown-inline-code', 2, 2],
  ['--dsw-alias-state-business-primary', 'var(--dshx-tone-accent)', 'var(--dshx-tone-accent)'],
  ['--dsw-alias-state-business-tertiary', 'var(--dshx-tone-accent-bg)', 'var(--dshx-tone-accent-bg)'],
  ['--dsw-alias-state-success-primary', 'var(--dshx-tone-success)', 'var(--dshx-tone-success)'],
  ['--dsw-alias-state-success-tertiary', 'var(--dshx-tone-success-bg)', 'var(--dshx-tone-success-bg)'],
  ['--dsw-alias-state-warn-primary', 'var(--dshx-tone-warning)', 'var(--dshx-tone-warning)'],
  ['--dsw-alias-state-warn-label', 'var(--dshx-tone-warning)', 'var(--dshx-tone-warning)'],
  ['--dsw-alias-state-warn-tertiary', 'var(--dshx-tone-warning-bg)', 'var(--dshx-tone-warning-bg)'],
  ['--dsw-alias-state-error-primary', 'var(--dshx-tone-danger)', 'var(--dshx-tone-danger)'],
  ['--dsw-alias-code-diff-added', 'var(--dshx-tone-success-bg)', 'var(--dshx-tone-success-bg)'],
  ['--dsw-alias-code-diff-deleted', 'var(--dshx-tone-danger-bg)', 'var(--dshx-tone-danger-bg)'],
  ['--dsw-specific-sidebar-fill', 1, 1],
  ['--dsw-specific-sidebar-nav-item-hover', 2, 2],
  ['--dsw-specific-sidebar-nav-item-active', 3, 3],
  ['--dsw-specific-sidebar-nav-item-active-accent', 'var(--dshx-tone-accent-bg)', 'var(--dshx-tone-accent-bg)'],
  ['--dsw-specific-bubble', 2, 2],
  ['--dsw-specific-bubble-highlight', 3, 3],
  ['--dsw-specific-input-major', 0, 2],
]

/** Syntax hues for Shiki's `css-variables` theme (keyword red, constant blue, parameter orange, function violet, string teal). */
const SYNTAX_HUES = { keyword: 20, constant: 245, parameter: 55, function: 300, string: 210 } as const

export function syntaxColor(hue: number, scheme: Scheme): Oklch {
  return scheme === 'dark' ? { l: 0.79, c: 0.11, h: hue } : { l: 0.5, c: 0.14, h: hue }
}

function retint(hex: string, hue: number, chroma: number): Oklch {
  const { l } = hexToOklch(hex)
  // Pure white and black stay off the ends: the spec avoids `#000`, and a warm white still reads white.
  return { l: Math.min(Math.max(l, 0.12), 0.995), c: chroma, h: hue }
}

function declarations(p: Palette, input: Omit<PaletteInput, 'scheme'>): string[] {
  const out: string[] = []
  const push = (name: string, value: string) => out.push(`  ${name}: ${value};`)
  p.neutral.forEach((color, step) => push(`--dshx-tone-${step}`, toCss(color)))
  NEUTRAL_STEP_NAMES.forEach((name, step) => push(`--dshx-tone-${name}`, tone(step)))
  push('--dshx-tone-accent', toCss(p.accent.fg))
  push('--dshx-tone-accent-bg', toCss(p.accent.bg))
  push('--dshx-tone-accent-border', toCss(p.accent.border))
  push('--dshx-tone-accent-on-solid', toCss(p.accent.onSolid))
  for (const key of ['success', 'warning', 'danger', 'info'] as const) {
    push(`--dshx-tone-${key}`, toCss(p[key].fg))
    push(`--dshx-tone-${key}-bg`, toCss(p[key].bg))
    push(`--dshx-tone-${key}-border`, toCss(p[key].border))
  }
  const fill = p.neutral[1]?.c ?? 0
  for (const [name, hex] of Object.entries(HOST_NEUTRAL_RAMPS)) push(`--dsw-static-${name}`, toCss(retint(hex, input.hue, fill)))
  for (const [name, hex] of Object.entries(HOST_BRAND_RAMP)) {
    const { l, c } = hexToOklch(hex)
    push(`--dsw-static-${name}`, toCss({ l, c, h: input.accentHue }))
  }
  const dark = p.scheme === 'dark'
  for (const [name, light, darkRef] of HOST_ALIASES) {
    const ref = dark ? darkRef : light
    push(name, typeof ref === 'number' ? tone(ref) : ref)
  }
  // Shiki `css-variables` theme: every token colour is `var(--shiki-token-*)` with no fallback.
  const syntax = (hue: number) => toCss(syntaxColor(hue, p.scheme))
  push('--shiki-token-comment', tone(8))
  push('--shiki-token-punctuation', tone(9))
  push('--shiki-token-constant', syntax(SYNTAX_HUES.constant))
  push('--shiki-token-keyword', syntax(SYNTAX_HUES.keyword))
  push('--shiki-token-parameter', syntax(SYNTAX_HUES.parameter))
  push('--shiki-token-function', syntax(SYNTAX_HUES.function))
  push('--shiki-token-string', syntax(SYNTAX_HUES.string))
  push('--shiki-token-string-expression', syntax(SYNTAX_HUES.string))
  push('--shiki-token-link', 'var(--dshx-tone-accent)')
  push('--shiki-token-inserted', 'var(--dshx-tone-success)')
  push('--shiki-token-deleted', 'var(--dshx-tone-danger)')
  push('--shiki-token-changed', 'var(--dshx-tone-warning)')
  return out
}

/** The declarations of one scheme's block; the runtime theme (`appearance.ts`) reuses them under its own selectors. */
export function blockDeclarations(input: Omit<PaletteInput, 'scheme'>, scheme: Scheme): string[] {
  return declarations(palette({ ...input, scheme }), input)
}

export function themeCss(input: Omit<PaletteInput, 'scheme'> = WARM_STONE): string {
  const radii = Object.entries(HOST_RADII).map(([name, px]) => `  --dsw-radius-${name}: ${px}px;`)
  const block = (selector: string, scheme: Scheme) => [`${selector} {`, ...blockDeclarations(input, scheme), '}'].join('\n')
  return [
    '/* Generated by plugins/@dshfiles/plugin-ui/scripts/emit-theme-css.ts from src/theme/palette.ts. Do not edit. */',
    `/* Input: ${JSON.stringify(input)} */`,
    '',
    [':root:root {', ...radii, '}'].join('\n'),
    '',
    block(LIGHT_SELECTOR, 'light'),
    '',
    block(DARK_SELECTOR, 'dark'),
    '',
  ].join('\n')
}

/** Every Host `--dsw-*` name this block overrides; the ui-styles guard test checks each still exists in the Host sheet. */
export function overriddenHostVariables(): readonly string[] {
  return [
    ...Object.keys(HOST_RADII).map(name => `--dsw-radius-${name}`),
    ...Object.keys(HOST_NEUTRAL_RAMPS).map(name => `--dsw-static-${name}`),
    ...Object.keys(HOST_BRAND_RAMP).map(name => `--dsw-static-${name}`),
    ...HOST_ALIASES.map(([name]) => name),
  ]
}
