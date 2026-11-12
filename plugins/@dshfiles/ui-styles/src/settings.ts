import Schema from '@deepseek-ai/schemastery'
import { APPEARANCE_BOUNDS } from '@dshfiles/plugin-ui/theme/appearance'
import { defineSettings } from '@dshfiles/dshx/settings'
import { UI_STYLES_SETTINGS_NAMESPACE } from './settings-namespace.js'

export { UI_STYLES_SETTINGS_NAMESPACE }

const override = (bounds: { readonly min: number; readonly max: number }, step: number, description: string) =>
  Schema.number().min(bounds.min).max(bounds.max).step(step).description(`${description} Leave empty to use the preset's value.`)

/**
 * Appearance (visual refresh P6). The default reproduces the static first-paint theme exactly (warm stone,
 * Geist, Geist Mono); light or dark stays the Host's Theme setting (`ui-theme.preference`).
 */
export const appearanceSettings = defineSettings({
  namespace: UI_STYLES_SETTINGS_NAMESPACE,
  schema: Schema.object({
    preset: Schema.union([
      Schema.const('warm-stone').description('Warm stone: warm grey, indigo accent (default)'),
      Schema.const('neutral').description('Neutral: pure grey, indigo accent'),
      Schema.const('high-contrast').description('High contrast: darker text and borders'),
      Schema.const('slate-blue').description('Slate blue: blue-grey, blue accent'),
      Schema.const('moss').description('Moss: green-grey, teal accent'),
    ])
      .default('warm-stone')
      .description('Colour preset for every surface, native and plugin, in both light and dark.'),
    greyHue: override(APPEARANCE_BOUNDS.hue, 1, 'Hue of the greys, 0–360 (65 is warm stone).'),
    greyTint: override(APPEARANCE_BOUNDS.chroma, 0.001, 'How tinted the greys are, 0–0.03 (0 is pure grey).'),
    accentHue: override(APPEARANCE_BOUNDS.accentHue, 1, 'Hue of the accent used for focus, selection and links, 0–360.'),
    contrast: override(APPEARANCE_BOUNDS.contrast, 0.05, 'Spread of borders and text from the background, 1–1.5.'),
    interfaceFont: Schema.union([Schema.const('geist').description('Geist (default)'), Schema.const('system').description('System font')])
      .default('geist')
      .description('Interface font. A family typed in Settings › Font still wins.'),
    codeFont: Schema.union([Schema.const('geist-mono').description('Geist Mono (default)'), Schema.const('system').description('System monospace')])
      .default('geist-mono')
      .description('Code font for code blocks, diffs and inline code.'),
    readingFont: Schema.union([
      Schema.const('sans').description('Interface font (default)'),
      Schema.const('serif').description('Serif (system Charter, Iowan or Georgia)'),
    ])
      .default('sans')
      .description('Font for reply prose in threads. Serif uses a font already on your device; code and tables keep their fonts.'),
  }).description('Colours and fonts for every surface, native and plugin, in light and dark. Light, dark or system is set in General › Appearance.'),
  applies: 'live',
})
