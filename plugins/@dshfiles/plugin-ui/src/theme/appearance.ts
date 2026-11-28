/**
 * Appearance presets and the runtime theme (visual refresh P6, T6.1–T6.2). The Appearance settings name a
 * preset plus optional overrides; `resolveAppearance` turns them into the generator input `palette()` takes, and
 * `runtimeThemeCss` emits the same declarations as the static block, under selectors that out-rank it, only when the
 * result differs from the default. The default therefore keeps the static first-paint sheet and injects nothing, so
 * there is no flash and no second copy of the block.
 */
import { DRACULA_THEME } from './dracula.ts'
import { GALLERY_IDS, GALLERY_THEMES } from './gallery.ts'
import { GENERIC_IDENTITY_NAMES, type IdentityNames } from './identity-palette.ts'
import { WARM_STONE, type PaletteInput } from './palette.ts'
import { ThemeCss } from './theme-css.ts'
import { READING_BOUNDS, ThemeDefinitionModel, type ReadingVeil, type SceneSources, type ThemeDefinition } from './theme-definition.ts'

export type ThemePresetId = 'warm-stone' | 'neutral' | 'high-contrast' | 'slate-blue' | 'moss' | 'dracula'
export type UiFont = 'geist' | 'system'
export type CodeFont = 'geist-mono' | 'system'

export type ThemeInput = Omit<PaletteInput, 'scheme'>

export interface ThemePreset extends ThemeInput {
  readonly id: ThemePresetId
  readonly label: string
  readonly description: string
  /** Exact colours and backdrop pinned over the generated palette while the preset has no override. */
  readonly definition?: ThemeDefinition
}

/** Every preset; each passes the WCAG AA text checks in both schemes (`plugin-ui/tests/appearance.test.ts`). */
const WARM_STONE_PRESET: ThemePreset = { id: 'warm-stone', label: 'Warm stone', description: 'Warm grey with an indigo accent (default).', ...WARM_STONE }

export const THEME_PRESETS: readonly ThemePreset[] = [
  WARM_STONE_PRESET,
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
  {
    id: 'dracula',
    label: 'Dracula',
    description: 'Official Dracula in dark, with a night sky behind the conversation, and its light companion Alucard.',
    ...ThemeDefinitionModel.baseInput(DRACULA_THEME),
    definition: DRACULA_THEME,
  },
]

export const PRESET_IDS: readonly string[] = THEME_PRESETS.map(preset => preset.id)

/** Ids a saved theme may not take: the presets and the built-in gallery themes. */
export const RESERVED_THEME_IDS: readonly string[] = [...PRESET_IDS, ...GALLERY_IDS]

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
  /**
   * The reading veil under the conversation column while a backdrop shows: blur of a still of the scene (px, 0–24) and
   * extra tint (percent, 0–100). Each theme keeps its own readability floor whatever these say; 0 adds nothing.
   */
  readonly readingBlur?: number
  readonly readingTint?: number
  /**
   * Most frames per second a backdrop scene is drawn at (0–120); 0 shows its resting picture. The display's own rate
   * caps it (`SCENE_FRAME_RATE`).
   */
  readonly sceneFrameRate?: number
  /** Id of a saved theme in `customThemes` or of a built-in gallery theme; when it names one, it replaces the preset. Empty: the preset. */
  readonly customTheme?: string
  /** Saved theme definitions, as stored: each is parsed on use and an invalid one is skipped. */
  readonly customThemes?: readonly unknown[]
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

function findPreset(id: string): ThemePreset {
  return THEME_PRESETS.find(preset => preset.id === id) ?? WARM_STONE_PRESET
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const pick = (override: number | undefined, fallback: number, key: keyof typeof APPEARANCE_BOUNDS) =>
  typeof override === 'number' && Number.isFinite(override) ? clamp(override, APPEARANCE_BOUNDS[key].min, APPEARANCE_BOUNDS[key].max) : fallback

/** The saved themes that parse; an invalid entry or one reusing a preset id is skipped, later duplicates too. */
function customThemes(settings: Partial<AppearanceSettings> | undefined): ThemeDefinition[] {
  const out: ThemeDefinition[] = []
  for (const raw of settings?.customThemes ?? []) {
    const { definition } = ThemeDefinitionModel.parse(raw, RESERVED_THEME_IDS)
    if (definition !== undefined && !out.some(theme => theme.id === definition.id)) out.push(definition)
  }
  return out
}

/** The theme in effect before overrides: the chosen saved theme when it exists, else the preset. */
export interface ActiveTheme {
  readonly base: ThemeInput
  readonly definition?: ThemeDefinition
}

function activeTheme(settings: Partial<AppearanceSettings> | undefined): ActiveTheme {
  const wanted = settings?.customTheme ?? ''
  const custom = wanted === '' ? undefined : [...customThemes(settings), ...GALLERY_THEMES].find(theme => theme.id === wanted)
  if (custom !== undefined) return { base: ThemeDefinitionModel.baseInput(custom), definition: custom }
  const preset = findPreset(settings?.preset ?? DEFAULT_PRESET)
  const base = { hue: preset.hue, chroma: preset.chroma, accentHue: preset.accentHue, contrast: preset.contrast }
  return preset.definition === undefined ? { base } : { base, definition: preset.definition }
}

/** The generator input for some Appearance settings: the active theme, then each override inside its bounds. */
function resolveAppearance(settings: Partial<AppearanceSettings> | undefined): ThemeInput {
  const { base } = activeTheme(settings)
  return {
    hue: pick(settings?.greyHue, base.hue, 'hue'),
    chroma: pick(settings?.greyTint, base.chroma, 'chroma'),
    accentHue: pick(settings?.accentHue, base.accentHue, 'accentHue'),
    contrast: pick(settings?.contrast, base.contrast, 'contrast'),
  }
}

function isDefaultInput(input: ThemeInput): boolean {
  return (
    input.hue === WARM_STONE.hue && input.chroma === WARM_STONE.chroma && input.accentHue === WARM_STONE.accentHue && input.contrast === WARM_STONE.contrast
  )
}

const isPresetInput = (preset: ThemeInput, input: ThemeInput): boolean =>
  input.hue === preset.hue && input.chroma === preset.chroma && input.accentHue === preset.accentHue && input.contrast === preset.contrast

/**
 * Runtime selectors: one more class-level part than the static ones, so they win whatever order the two sheets end up
 * in. Light (0,1,2) beats the static light (0,0,2) and the Host dark (0,1,1) but loses to the static dark (0,2,1), so
 * a runtime light value never leaks into dark; runtime dark (0,3,1) beats the static dark.
 */
export const RUNTIME_LIGHT_SELECTOR = 'html:root body'
export const RUNTIME_DARK_SELECTOR = 'body[data-ds-dark-theme][data-ds-dark-theme][data-ds-dark-theme]'

const UI_FONT_STACKS = {
  geist:
    "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif",
} as const satisfies Readonly<Record<UiFont, string>>
const CODE_FONT_STACKS = {
  'geist-mono':
    "'Geist Mono', 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei', monospace",
  system: "'SF Mono', ui-monospace, 'JetBrains Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei', monospace",
} as const satisfies Readonly<Record<CodeFont, string>>

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
function runtimeThemeCss(settings: Partial<AppearanceSettings> | undefined, scenes: SceneSources = new Map()): string {
  const input = resolveAppearance(settings)
  const { base, definition } = activeTheme(settings)
  // An override asks for the generated palette: the definition's exact colours and backdrop apply only without one.
  const pinned = definition !== undefined && isPresetInput(base, input) ? definition : undefined
  const parts: string[] = []
  if (!isDefaultInput(input) || pinned !== undefined) {
    const block = (selector: string, scheme: 'light' | 'dark') => [`${selector} {`, ...ThemeCss.blockDeclarations(input, scheme), '}'].join('\n')
    parts.push(block(RUNTIME_LIGHT_SELECTOR, 'light'), block(RUNTIME_DARK_SELECTOR, 'dark'))
    if (pinned !== undefined)
      parts.push(ThemeDefinitionModel.css(pinned, { light: RUNTIME_LIGHT_SELECTOR, dark: RUNTIME_DARK_SELECTOR }, scenes, readingVeil(settings)))
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

const bounded = (value: number | undefined, key: keyof typeof READING_BOUNDS): number =>
  typeof value === 'number' && Number.isFinite(value) ? clamp(value, READING_BOUNDS[key].min, READING_BOUNDS[key].max) : 0

/**
 * Bounds of `sceneFrameRate`. A scene is drawn on a canvas from pictures rasterised once, so a frame costs a few image
 * draws: the default is smooth on any display, and lower values only save a little more (measurements in
 * docs/performance.md).
 */
export const SCENE_FRAME_RATE = { min: 0, max: 120, default: 60 } as const

/** The scene frame rate in effect, inside its bounds: whole frames per second, 0 for the resting picture. */
function sceneFrameRate(settings: { readonly sceneFrameRate?: number | undefined } | undefined): number {
  const value = settings?.sceneFrameRate
  if (value === undefined || !Number.isFinite(value)) return SCENE_FRAME_RATE.default
  return Math.round(clamp(value, SCENE_FRAME_RATE.min, SCENE_FRAME_RATE.max))
}

/** The user's reading veil, inside its bounds. */
function readingVeil(settings: Partial<AppearanceSettings> | undefined): ReadingVeil {
  return { blur: bounded(settings?.readingBlur, 'blur'), tint: bounded(settings?.readingTint, 'tint') }
}

/**
 * The identity slot names the active theme gives, per scheme it defines (round eight): its `paletteNames`, or
 * "Colour 1"… for a palette without names. Empty while the default slots apply (no pinned theme), so the swatches keep
 * the default names; the client writes it to `PALETTE_NAMES_ATTRIBUTE`.
 */
function identityNames(settings: Partial<AppearanceSettings> | undefined): IdentityNames {
  const input = resolveAppearance(settings)
  const { base, definition } = activeTheme(settings)
  if (definition === undefined || !isPresetInput(base, input)) return {}
  let names: IdentityNames = {}
  if (definition.light !== undefined) names = { ...names, light: definition.light.paletteNames ?? GENERIC_IDENTITY_NAMES }
  if (definition.dark !== undefined) names = { ...names, dark: definition.dark.paletteNames ?? GENERIC_IDENTITY_NAMES }
  return names
}

/** The built-in scenes the active theme paints, so the client can ask the Host for their SVG. */
function scenesNeeded(settings: Partial<AppearanceSettings> | undefined): string[] {
  const input = resolveAppearance(settings)
  const { base, definition } = activeTheme(settings)
  return definition !== undefined && isPresetInput(base, input) ? ThemeDefinitionModel.scenesOf(definition) : []
}

/** The static block for a preset, for review tables. */
function presetThemeCss(id: ThemePresetId): string {
  return ThemeCss.themeCss(resolveAppearance({ preset: id }))
}

/** Appearance settings resolved to theme presets, inputs and runtime CSS. */
export class AppearanceModel {
  static readonly findPreset = findPreset
  static readonly customThemes = customThemes
  static readonly activeTheme = activeTheme
  static readonly resolveAppearance = resolveAppearance
  static readonly isDefaultInput = isDefaultInput
  static readonly runtimeThemeCss = runtimeThemeCss
  static readonly scenesNeeded = scenesNeeded
  static readonly identityNames = identityNames
  static readonly sceneFrameRate = sceneFrameRate
  static readonly presetThemeCss = presetThemeCss
}
