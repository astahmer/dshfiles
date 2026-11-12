import {
  DEFAULT_APPEARANCE,
  isDefaultInput,
  resolveAppearance,
  THEME_PRESETS,
  type AppearanceSettings,
  type ThemePresetId,
} from '@dshfiles/plugin-ui/theme/appearance'
import type { ThemeSetInput, ThemeState } from './api.js'

type Overrides = Pick<AppearanceSettings, 'greyHue' | 'greyTint' | 'accentHue' | 'contrast'>
const OVERRIDE_KEYS = ['greyHue', 'greyTint', 'accentHue', 'contrast'] as const

const PRESET_IDS: ReadonlySet<string> = new Set(THEME_PRESETS.map(preset => preset.id))
const asPreset = (value: unknown): ThemePresetId => (typeof value === 'string' && PRESET_IDS.has(value) ? (value as ThemePresetId) : DEFAULT_APPEARANCE.preset)
const asNumber = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** The stored settings, normalised: unknown presets fall back to the default, non-numbers are no override. */
export function normaliseAppearance(stored: Partial<Record<keyof AppearanceSettings, unknown>> | undefined): AppearanceSettings {
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
export function nextAppearance(current: AppearanceSettings, input: ThemeSetInput): AppearanceSettings {
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

export function themeState(settings: AppearanceSettings, scheme: string): ThemeState {
  const resolved = resolveAppearance(settings)
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
      isDefaultInput(resolved) &&
      settings.interfaceFont === DEFAULT_APPEARANCE.interfaceFont &&
      settings.codeFont === DEFAULT_APPEARANCE.codeFont &&
      settings.readingFont === DEFAULT_APPEARANCE.readingFont,
    presets: THEME_PRESETS.map(({ id, label, description }) => ({ id, label, description })),
  }
}
