import { AppearanceModel, DEFAULT_APPEARANCE, THEME_PRESETS, type AppearanceSettings, type ThemePresetId } from '@dshfiles/plugin-ui/theme/appearance'
import type { ThemeSetInput, ThemeState } from './api.js'

type Overrides = Pick<AppearanceSettings, 'greyHue' | 'greyTint' | 'accentHue' | 'contrast'>
const OVERRIDE_KEYS = ['greyHue', 'greyTint', 'accentHue', 'contrast'] as const

const PRESET_IDS: ReadonlySet<string> = new Set(THEME_PRESETS.map(preset => preset.id))
const isPresetId = (value: string): value is ThemePresetId => PRESET_IDS.has(value)
const asPreset = (value: unknown): ThemePresetId => (typeof value === 'string' && isPresetId(value) ? value : DEFAULT_APPEARANCE.preset)
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
  }
}

/** The next stored settings for one `theme_set` call; `reset` restores the defaults. */
function nextAppearance(current: AppearanceSettings, input: ThemeSetInput): AppearanceSettings {
  if (input.reset === true) return DEFAULT_APPEARANCE
  // A new preset starts from its own values: overrides only survive when the same call names them.
  const base: Overrides = input.preset === undefined ? pickOverrides(current) : {}
  const overrides: Record<string, number> = {}
  for (const key of OVERRIDE_KEYS) {
    const given = input[key]
    const value = given === undefined ? base[key] : given === null ? undefined : given
    if (value !== undefined) overrides[key] = value
  }
  return {
    preset: input.preset ?? current.preset,
    ...overrides,
    interfaceFont: input.interfaceFont ?? current.interfaceFont,
    codeFont: input.codeFont ?? current.codeFont,
    readingFont: input.readingFont ?? current.readingFont,
  }
}

function pickOverrides(settings: AppearanceSettings): Overrides {
  const out: Record<string, number> = {}
  for (const key of OVERRIDE_KEYS) {
    const value = settings[key]
    if (value !== undefined) out[key] = value
  }
  return out
}

function themeState(settings: AppearanceSettings, scheme: string): ThemeState {
  const resolved = AppearanceModel.resolveAppearance(settings)
  return {
    preset: settings.preset,
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
    scheme,
    isDefault:
      AppearanceModel.isDefaultInput(resolved) &&
      settings.interfaceFont === DEFAULT_APPEARANCE.interfaceFont &&
      settings.codeFont === DEFAULT_APPEARANCE.codeFont &&
      settings.readingFont === DEFAULT_APPEARANCE.readingFont,
    presets: THEME_PRESETS.map(({ id, label, description }) => ({ id, label, description })),
  }
}

/** Stored appearance normalised, updated and summarised for the theme tools. */
export class ThemeStateModel {
  static readonly normaliseAppearance = normaliseAppearance
  static readonly nextAppearance = nextAppearance
  static readonly themeState = themeState
}
