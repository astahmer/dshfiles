import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

/**
 * The theme contract (visual refresh T6.3). The Host method is the only implementation of a theme change; the
 * Settings › Appearance fields write the same settings namespace, so the agent and the form cannot disagree.
 */

const presetId = Schema.Literals(['warm-stone', 'neutral', 'high-contrast', 'slate-blue', 'moss'])
const uiFont = Schema.Literals(['geist', 'system'])
const codeFont = Schema.Literals(['geist-mono', 'system'])
const readingFont = Schema.Literals(['sans', 'serif'])
const finite = Schema.Number.check(Schema.isFinite())

const presetSchema = Schema.Struct({ id: presetId, label: Schema.String, description: Schema.String })

const themeStateSchema = Schema.Struct({
  preset: presetId,
  /** The values in effect: the preset's, or an override. */
  greyHue: finite,
  greyTint: finite,
  accentHue: finite,
  contrast: finite,
  /** The overrides stored on top of the preset; null means the preset's value. */
  overrides: Schema.Struct({
    greyHue: Schema.NullOr(finite),
    greyTint: Schema.NullOr(finite),
    accentHue: Schema.NullOr(finite),
    contrast: Schema.NullOr(finite),
  }),
  interfaceFont: uiFont,
  codeFont,
  /** Reply prose: the interface sans (default) or a system serif. */
  readingFont,
  /** The Host's light/dark preference (Settings › Theme), read-only here; `unknown` when that row is absent. */
  scheme: Schema.String,
  /** True when every value is the default, so the static first-paint theme is the whole theme. */
  isDefault: Schema.Boolean,
  presets: Schema.Array(presetSchema),
})

const overrideInput = (description: string) => Schema.optional(Schema.NullOr(finite).annotate({ description: `${description} null clears the override.` }))

const themeSetInputSchema = Schema.Struct({
  reset: Schema.optional(
    Schema.Literal(true).annotate({ description: 'true restores every default (warm stone, Geist, Geist Mono); other fields are ignored.' }),
  ),
  preset: Schema.optional(
    presetId.annotate({
      description: 'Colour preset. Choosing one clears the grey hue, grey tint, accent hue and contrast overrides not given in the same call.',
    }),
  ),
  greyHue: overrideInput('Hue of the greys, 0–360.'),
  greyTint: overrideInput('Tint of the greys, 0–0.03.'),
  accentHue: overrideInput('Hue of the accent, 0–360.'),
  contrast: overrideInput('Spread of borders and text, 1–1.5.'),
  interfaceFont: Schema.optional(uiFont.annotate({ description: 'Interface font.' })),
  codeFont: Schema.optional(codeFont.annotate({ description: 'Code font.' })),
  readingFont: Schema.optional(
    readingFont.annotate({ description: 'Reply prose font in threads: sans (default) or serif (a system serif, nothing downloaded).' }),
  ),
})

export type ThemeState = typeof themeStateSchema.Type
export type ThemeSetInput = typeof themeSetInputSchema.Type

const render = (state: ThemeState): string => JSON.stringify({ ...state, presets: state.presets.map(preset => preset.id) })

export const themeApi = defineApi({
  id: 'ui-theme-appearance',
  version: 1,
  owner: '@dshfiles/ui-styles',
  methods: {
    get: method({
      input: Schema.Struct({}),
      output: themeStateSchema,
      description:
        'The Appearance theme: colour preset, the grey hue, grey tint, accent hue and contrast in effect and their overrides, UI, code and reading font, the light/dark preference and the available presets. Read-only.',
      tool: { name: 'theme_get', readOnly: true, render },
    }),
    set: method({
      input: themeSetInputSchema,
      output: themeStateSchema,
      description:
        'Change the Appearance theme for every surface: a preset, per-value overrides or the fonts; reset: true restores the defaults. Call only when the user asked to change the theme. Reversible: theme_get shows the previous state and reset: true returns to the defaults. Light or dark is the separate Theme setting (ui-theme preference).',
      tool: { name: 'theme_set', readOnly: false, render },
    }),
  },
})
