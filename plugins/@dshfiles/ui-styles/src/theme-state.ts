import {
  AppearanceModel,
  DEFAULT_APPEARANCE,
  PRESET_IDS,
  RESERVED_THEME_IDS,
  SCENE_FRAME_RATE,
  THEME_PRESETS,
  type AppearanceSettings,
  type ThemePresetId,
} from '@dshfiles/plugin-ui/theme/appearance'
import { ThemeDefinitionModel, type ThemeDefinition } from '@dshfiles/plugin-ui/theme/definition'
import { GALLERY_IDS, GALLERY_THEMES } from '@dshfiles/plugin-ui/theme/gallery'
import type { ThemeDefineInput, ThemeSetInput, ThemeState } from './api.js'

type Overrides = Pick<AppearanceSettings, 'greyHue' | 'greyTint' | 'accentHue' | 'contrast'>
const OVERRIDE_KEYS = ['greyHue', 'greyTint', 'accentHue', 'contrast'] as const

const PRESET_ID_SET: ReadonlySet<string> = new Set(PRESET_IDS)
const isPresetId = (value: string): value is ThemePresetId => PRESET_ID_SET.has(value)
const asPreset = (value: unknown): ThemePresetId => (typeof value === 'string' && isPresetId(value) ? value : DEFAULT_APPEARANCE.preset)
/** A whole number inside 0–max, as the settings schema stores it. */
const clampTo = (value: number, max: number): number => Math.round(Math.min(max, Math.max(0, value)))
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** The Appearance settings as stored: any field may be missing or hold a value an older or newer schema wrote. */
interface StoredAppearance {
  readonly preset?: unknown
  readonly greyHue?: unknown
  readonly greyTint?: unknown
  readonly accentHue?: unknown
  readonly contrast?: unknown
  readonly interfaceFont?: unknown
  readonly codeFont?: unknown
  readonly readingFont?: unknown
  readonly readingBlur?: unknown
  readonly readingTint?: unknown
  readonly sceneFrameRate?: unknown
  readonly customTheme?: unknown
  readonly customThemes?: unknown
}

/** A theme refused by `theme_define`, with every problem so the agent can fix the definition in one retry. */
export class InvalidThemeDefinition extends Error {
  override readonly name = 'InvalidThemeDefinition'
  constructor(readonly problems: readonly string[]) {
    super(`The theme was not saved: ${problems.join('; ')}.`)
  }
}

/** The stored settings, normalised: unknown presets fall back to the default, non-numbers are no override. */
function normaliseAppearance(stored: StoredAppearance | undefined): AppearanceSettings {
  const overrides: Record<string, number> = {}
  for (const key of OVERRIDE_KEYS) {
    const value = asNumber(stored?.[key])
    if (value !== undefined) overrides[key] = value
  }
  return {
    preset: asPreset(stored?.preset),
    ...overrides,
    interfaceFont: stored?.interfaceFont === 'system' ? 'system' : 'geist',
    codeFont: stored?.codeFont === 'system' ? 'system' : 'geist-mono',
    readingFont: stored?.readingFont === 'serif' ? 'serif' : 'sans',
    readingBlur: asNumber(stored?.readingBlur) ?? 0,
    readingTint: asNumber(stored?.readingTint) ?? 0,
    sceneFrameRate: AppearanceModel.sceneFrameRate({ sceneFrameRate: asNumber(stored?.sceneFrameRate) }),
    customTheme: typeof stored?.customTheme === 'string' ? stored.customTheme : '',
    customThemes: Array.isArray(stored?.customThemes) ? stored.customThemes : [],
  }
}

/** The next stored settings for one `theme_set` call; `reset` restores the defaults and keeps the saved themes. */
function nextAppearance(current: AppearanceSettings, input: ThemeSetInput): AppearanceSettings {
  const customThemes = current.customThemes ?? []
  if (input.reset === true)
    return { ...DEFAULT_APPEARANCE, readingBlur: 0, readingTint: 0, sceneFrameRate: SCENE_FRAME_RATE.default, customTheme: '', customThemes }
  // A new preset or saved theme starts from its own values: overrides only survive when the same call names them.
  const switching = input.preset !== undefined || input.customTheme !== undefined
  const base: Overrides = switching ? {} : pickOverrides(current)
  const overrides: Record<string, number> = {}
  for (const key of OVERRIDE_KEYS) {
    const given = input[key]
    const value = given === undefined ? base[key] : given === null ? undefined : given
    if (value !== undefined) overrides[key] = value
  }
  const customTheme = input.customTheme !== undefined ? (input.customTheme ?? '') : input.preset !== undefined ? '' : (current.customTheme ?? '')
  if (customTheme !== '' && !GALLERY_IDS.includes(customTheme) && !AppearanceModel.customThemes(current).some(theme => theme.id === customTheme))
    throw new InvalidThemeDefinition([
      `no saved or gallery theme "${customTheme}"; theme_get lists savedThemes and galleryThemes, theme_define saves a new one`,
    ])
  return {
    preset: input.preset ?? current.preset,
    ...overrides,
    interfaceFont: input.interfaceFont ?? current.interfaceFont,
    codeFont: input.codeFont ?? current.codeFont,
    readingFont: input.readingFont ?? current.readingFont,
    readingBlur: clampTo(input.readingBlur ?? current.readingBlur ?? 0, 24),
    readingTint: clampTo(input.readingTint ?? current.readingTint ?? 0, 100),
    sceneFrameRate: AppearanceModel.sceneFrameRate({ sceneFrameRate: input.sceneFrameRate ?? current.sceneFrameRate }),
    customTheme,
    customThemes,
  }
}

/** The settings after saving a theme (replacing one with the same id), switched to it unless `apply` is false. */
function defineTheme(current: AppearanceSettings, input: ThemeDefineInput): AppearanceSettings {
  const { definition, errors } = ThemeDefinitionModel.parse(input.theme, RESERVED_THEME_IDS)
  if (definition === undefined) throw new InvalidThemeDefinition(errors)
  const kept = (current.customThemes ?? []).filter(raw => !(typeof raw === 'object' && raw !== null && 'id' in raw && raw.id === definition.id))
  const customThemes = [...kept, definition]
  if (input.apply === false) return { ...current, customThemes }
  // Switching starts from the theme's own colours, as choosing a preset does: overrides are dropped.
  return {
    preset: current.preset,
    interfaceFont: current.interfaceFont,
    codeFont: current.codeFont,
    readingFont: current.readingFont,
    readingBlur: current.readingBlur ?? 0,
    readingTint: current.readingTint ?? 0,
    sceneFrameRate: AppearanceModel.sceneFrameRate(current),
    customTheme: definition.id,
    customThemes,
  }
}

/** The settings without one saved theme; the preset applies again when it was in use. */
function removeTheme(current: AppearanceSettings, id: string): AppearanceSettings {
  const before = current.customThemes ?? []
  const customThemes = before.filter(raw => !(typeof raw === 'object' && raw !== null && 'id' in raw && raw.id === id))
  if (customThemes.length === before.length)
    throw new InvalidThemeDefinition([GALLERY_IDS.includes(id) ? `"${id}" is a built-in gallery theme and cannot be removed` : `no saved theme "${id}"`])
  return { ...current, customThemes, customTheme: current.customTheme === id ? '' : (current.customTheme ?? '') }
}

function pickOverrides(settings: AppearanceSettings): Overrides {
  const out: Record<string, number> = {}
  for (const key of OVERRIDE_KEYS) {
    const value = settings[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

const savedTheme = (theme: ThemeDefinition): ThemeState['savedThemes'][number] => ({
  id: theme.id,
  label: theme.label,
  description: theme.description ?? '',
  schemes: (['dark', 'light'] as const).filter(scheme => theme[scheme] !== undefined),
  backdrop: theme.dark?.backdrop !== undefined || theme.light?.backdrop !== undefined,
})

function themeState(settings: AppearanceSettings, scheme: string): ThemeState {
  const resolved = AppearanceModel.resolveAppearance(settings)
  const saved = AppearanceModel.customThemes(settings)
  const active = [...saved, ...GALLERY_THEMES].find(theme => theme.id === settings.customTheme)
  const definition = AppearanceModel.activeTheme(settings).definition
  return {
    preset: settings.preset,
    customTheme: active?.id ?? null,
    greyHue: resolved.hue,
    greyTint: resolved.chroma,
    accentHue: resolved.accentHue,
    contrast: resolved.contrast,
    overrides: {
      greyHue: settings.greyHue ?? null,
      greyTint: settings.greyTint ?? null,
      accentHue: settings.accentHue ?? null,
      contrast: settings.contrast ?? null,
    },
    interfaceFont: settings.interfaceFont,
    codeFont: settings.codeFont,
    readingFont: settings.readingFont,
    readingBlur: settings.readingBlur ?? 0,
    readingTint: settings.readingTint ?? 0,
    sceneFrameRate: AppearanceModel.sceneFrameRate(settings),
    scheme,
    isDefault:
      active === undefined &&
      definition === undefined &&
      AppearanceModel.isDefaultInput(resolved) &&
      settings.interfaceFont === DEFAULT_APPEARANCE.interfaceFont &&
      settings.codeFont === DEFAULT_APPEARANCE.codeFont &&
      settings.readingFont === DEFAULT_APPEARANCE.readingFont,
    presets: THEME_PRESETS.map(({ id, label, description }) => ({ id, label, description })),
    savedThemes: saved.map(savedTheme),
    galleryThemes: GALLERY_THEMES.map(savedTheme),
    contrastWarnings: definition === undefined ? [] : ThemeDefinitionModel.contrastWarnings(definition),
  }
}

/** Stored appearance normalised, updated and summarised for the theme tools. */
export class ThemeStateModel {
  static readonly normaliseAppearance = normaliseAppearance
  static readonly nextAppearance = nextAppearance
  static readonly defineTheme = defineTheme
  static readonly removeTheme = removeTheme
  static readonly themeState = themeState
}
