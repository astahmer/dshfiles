/**
 * Appearance presets and the runtime theme (visual refresh P6, T6.1–T6.2). The Appearance settings name a
 * preset plus optional overrides; `resolveAppearance` turns them into the generator input `palette()` takes, and
 * `runtimeThemeCss` emits the same declarations as the static block, under selectors that out-rank it, only when the
 * result differs from the default. The default therefore keeps the static first-paint sheet and injects nothing, so
 * there is no flash and no second copy of the block.
 */
import { WARM_STONE, type PaletteInput } from './palette.ts'
import { blockDeclarations, themeCss } from './theme-css.ts'

export type ThemePresetId = 'warm-stone' | 'neutral' | 'high-contrast' | 'slate-blue' | 'moss'
export type UiFont = 'geist' | 'system'
export type CodeFont = 'geist-mono' | 'system'

export type ThemeInput = Omit<PaletteInput, 'scheme'>

export interface ThemePreset extends ThemeInput {
  readonly id: ThemePresetId
  readonly label: string
  readonly description: string
}

/** Every preset; each passes the WCAG AA text checks in both schemes (`plugin-ui/tests/appearance.test.ts`). */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: 'warm-stone', label: 'Warm stone', description: 'Warm grey with an indigo accent (default).', ...WARM_STONE },
  { id: 'neutral', label: 'Neutral', description: 'Pure grey with an indigo accent.', hue: 65, chroma: 0, accentHue: 270, contrast: 1 },
  {
    id: 'high-contrast',
    label: 'High contrast',
    description: 'Darker text and borders against the same fills.',
    hue: 65,
    chroma: 0.004,
    accentHue: 270,
    contrast: 1.35,
  },
  { id: 'slate-blue', label: 'Slate blue', description: 'Cool blue-grey with a blue accent.', hue: 250, chroma: 0.014, accentHue: 255, contrast: 1 },
  { id: 'moss', label: 'Moss', description: 'Green-grey with a teal accent.', hue: 135, chroma: 0.013, accentHue: 200, contrast: 1 },
]

export const DEFAULT_PRESET: ThemePresetId = 'warm-stone'

/** The stored Appearance settings: a preset, optional per-value overrides, and the two font choices. */
export interface AppearanceSettings {
  readonly preset: ThemePresetId
  /** Hue of the greys (the palette's `hue`). */
  readonly greyHue?: number
  /** Tint of the greys (the palette's `chroma`). */
  readonly greyTint?: number
  readonly accentHue?: number
  readonly contrast?: number
  readonly interfaceFont: UiFont
  readonly codeFont: CodeFont
  /** Reply prose in the transcript: the interface sans (default) or a system serif (productivity pass T6.6). */
  readonly readingFont: ReadingFont
}

export type ReadingFont = 'sans' | 'serif'

export const DEFAULT_APPEARANCE: AppearanceSettings = { preset: DEFAULT_PRESET, interfaceFont: 'geist', codeFont: 'geist-mono', readingFont: 'sans' }

/** Bounds the settings schema enforces; the AA test also walks their corners. */
export const APPEARANCE_BOUNDS = {
  hue: { min: 0, max: 360 },
  chroma: { min: 0, max: 0.03 },
  accentHue: { min: 0, max: 360 },
  contrast: { min: 1, max: 1.5 },
} as const

export function findPreset(id: string): ThemePreset {
  return THEME_PRESETS.find(preset => preset.id === id) ?? (THEME_PRESETS[0] as ThemePreset)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const pick = (override: number | undefined, fallback: number, key: keyof typeof APPEARANCE_BOUNDS) =>
  typeof override === 'number' && Number.isFinite(override) ? clamp(override, APPEARANCE_BOUNDS[key].min, APPEARANCE_BOUNDS[key].max) : fallback

/** The generator input for some Appearance settings: the preset, then each override inside its bounds. */
export function resolveAppearance(settings: Partial<AppearanceSettings> | undefined): ThemeInput {
  const preset = findPreset(settings?.preset ?? DEFAULT_PRESET)
  return {
    hue: pick(settings?.greyHue, preset.hue, 'hue'),
    chroma: pick(settings?.greyTint, preset.chroma, 'chroma'),
    accentHue: pick(settings?.accentHue, preset.accentHue, 'accentHue'),
    contrast: pick(settings?.contrast, preset.contrast, 'contrast'),
  }
}

export function isDefaultInput(input: ThemeInput): boolean {
  return (
    input.hue === WARM_STONE.hue && input.chroma === WARM_STONE.chroma && input.accentHue === WARM_STONE.accentHue && input.contrast === WARM_STONE.contrast
  )
}

/**
 * Runtime selectors: one more class-level part than the static ones, so they win whatever order the two sheets end up
 * in. Light (0,1,2) beats the static light (0,0,2) and the Host dark (0,1,1) but loses to the static dark (0,2,1), so
 * a runtime light value never leaks into dark; runtime dark (0,3,1) beats the static dark.
 */
export const RUNTIME_LIGHT_SELECTOR = 'html:root body'
export const RUNTIME_DARK_SELECTOR = 'body[data-ds-dark-theme][data-ds-dark-theme][data-ds-dark-theme]'

const UI_FONT_STACKS: Readonly<Record<UiFont, string>> = {
  geist:
    "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif",
}
const CODE_FONT_STACKS: Readonly<Record<CodeFont, string>> = {
  'geist-mono':
    "'Geist Mono', 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei', monospace",
  system: "'SF Mono', ui-monospace, 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei', monospace",
}

/**
 * The reading serif: system faces only (Charter on Apple devices, Iowan Old Style, then Georgia everywhere), so choosing
 * it downloads nothing and the default sans pays nothing.
 */
export const READING_SERIF_STACK =
  "Charter, 'Bitstream Charter', 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Noto Serif', 'Songti SC', 'SimSun', serif"

/** Assistant reply prose in the transcript: the native Markdown root (`data-dsh-markdown`), never code, tables or chrome. */
const READING_PROSE = ":is([data-conversation-scroll], [data-slot='conversation.chat.flow']) [data-dsh-markdown] :is(p, li, blockquote, h1, h2, h3, h4, h5, h6)"

/** The font stacks `ui-styles/src/fonts.css` declares statically, exported so a test keeps the two equal. */
export const DEFAULT_FONT_STACKS = { text: UI_FONT_STACKS.geist, code: CODE_FONT_STACKS['geist-mono'] } as const

/**
 * The CSS the runtime injects for some Appearance settings, or `''` when they reproduce the static default. Palette
 * and font overrides are independent: a font-only change emits only the font block.
 */
export function runtimeThemeCss(settings: Partial<AppearanceSettings> | undefined): string {
  const input = resolveAppearance(settings)
  const parts: string[] = []
  if (!isDefaultInput(input)) {
    const block = (selector: string, scheme: 'light' | 'dark') => [`${selector} {`, ...blockDeclarations(input, scheme), '}'].join('\n')
    parts.push(block(RUNTIME_LIGHT_SELECTOR, 'light'), block(RUNTIME_DARK_SELECTOR, 'dark'))
  }
  const uiFont = settings?.interfaceFont ?? DEFAULT_APPEARANCE.interfaceFont
  const codeFont = settings?.codeFont ?? DEFAULT_APPEARANCE.codeFont
  const fonts: string[] = []
  // The Host's `-default` stacks stay the hook (Settings › Font still wins), as in fonts.css; `:root:root:root` beats it.
  if (uiFont !== DEFAULT_APPEARANCE.interfaceFont) fonts.push(`  --dsh-font-family-text-default: ${UI_FONT_STACKS[uiFont] ?? UI_FONT_STACKS.geist};`)
  if (codeFont !== DEFAULT_APPEARANCE.codeFont) fonts.push(`  --dsh-font-family-code-default: ${CODE_FONT_STACKS[codeFont] ?? CODE_FONT_STACKS['geist-mono']};`)
  if (fonts.length > 0) parts.push([':root:root:root {', ...fonts, '}'].join('\n'))
  if (settings?.readingFont === 'serif')
    parts.push(
      [
        `${READING_PROSE} {`,
        `  font-family: ${READING_SERIF_STACK};`,
        '}',
        // Code inside a paragraph keeps the code font.
        `${READING_PROSE} :is(code, kbd, samp) {`,
        '  font-family: var(--ds-font-family-code);',
        '}',
      ].join('\n'),
    )
  return parts.join('\n\n')
}

/** The static block for a preset, for review tables. */
export function presetThemeCss(id: ThemePresetId): string {
  return themeCss(resolveAppearance({ preset: id }))
}
