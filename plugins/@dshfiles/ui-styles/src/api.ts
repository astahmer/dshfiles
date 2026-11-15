import { defineApi, method } from '@dshfiles/dshx/api'
import { ACCENT_ROLES, MAX_BACKDROP_LAYERS, NEUTRAL_ROLES, ROLE_GUIDE, SYNTAX_ROLES } from '@dshfiles/plugin-ui/theme/definition'
import { SCENE_IDS } from '@dshfiles/plugin-ui/theme/scenes'
import * as Schema from 'effect/Schema'

/**
 * The theme contract (visual refresh T6.3). The Host method is the only implementation of a theme change; the
 * Settings › Appearance fields write the same settings namespace, so the agent and the form cannot disagree.
 */

const presetId = Schema.Literals(['warm-stone', 'neutral', 'high-contrast', 'slate-blue', 'moss', 'dracula'])
const uiFont = Schema.Literals(['geist', 'system'])
const codeFont = Schema.Literals(['geist-mono', 'system'])
const readingFont = Schema.Literals(['sans', 'serif'])
const finite = Schema.Number.check(Schema.isFinite())

const presetSchema = Schema.Struct({ id: presetId, label: Schema.String, description: Schema.String })

const savedThemeSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  /** The schemes the theme defines; the others use the palette generated from its hues. */
  schemes: Schema.Array(Schema.Literals(['dark', 'light'])),
  /** True when a scheme has a backdrop. */
  backdrop: Schema.Boolean,
})

const themeStateSchema = Schema.Struct({
  preset: presetId,
  /** The saved theme in use instead of the preset, or null. */
  customTheme: Schema.NullOr(Schema.String),
  /** The values in effect: the active theme's, or an override. */
  greyHue: finite,
  greyTint: finite,
  accentHue: finite,
  contrast: finite,
  /** The overrides stored on top of the theme; null means the theme's value. */
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
  /** The reading veil the user asked for: blur (px, 0–24) and extra tint (percent, 0–100) under the conversation column. */
  readingBlur: finite,
  readingTint: finite,
  /** Frames per second a backdrop scene moves at; 0 is a still picture. */
  sceneFrameRate: finite,
  /** The Host's light/dark preference (Settings › Theme), read-only here; `unknown` when that row is absent. */
  scheme: Schema.String,
  /** True when every value is the default, so the static first-paint theme is the whole theme. */
  isDefault: Schema.Boolean,
  presets: Schema.Array(presetSchema),
  savedThemes: Schema.Array(savedThemeSchema),
  /** Built-in themes painting one of Claude Code's animated scenes; choose one with theme_set customTheme. */
  galleryThemes: Schema.Array(savedThemeSchema),
  /** Text pairs of the active theme under WCAG AA; tell the user, who may keep them (an official palette) or ask for a fix. */
  contrastWarnings: Schema.Array(Schema.String),
})

const overrideInput = (description: string) => Schema.optional(Schema.NullOr(finite).annotate({ description: `${description} null clears the override.` }))

const themeSetInputSchema = Schema.Struct({
  reset: Schema.optional(
    Schema.Literal(true).annotate({ description: 'true restores every default (warm stone, Geist, Geist Mono, no saved theme); other fields are ignored.' }),
  ),
  preset: Schema.optional(
    presetId.annotate({
      description:
        'Colour preset. Choosing one clears the saved theme in use and the grey hue, grey tint, accent hue and contrast overrides not given in the same call.',
    }),
  ),
  customTheme: Schema.optional(
    Schema.NullOr(Schema.String).annotate({
      description:
        'Id of a saved theme (savedThemes in theme_get) or a built-in gallery theme (galleryThemes: honu-lagoon, koi-mosaic, night-reef, snow-pines, aurora…) to use instead of the preset; clears overrides not given in the same call. null returns to the preset. A gallery scene made for one kind of window shows only in that scheme: set ui-theme preference to match.',
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
  readingBlur: Schema.optional(
    finite.annotate({
      description:
        'Blur under the conversation column while a backdrop scene shows, in px, 0–24 (0: none). Cheap: a still of the scene is blurred once; the scene keeps moving on the sides.',
    }),
  ),
  readingTint: Schema.optional(
    finite.annotate({
      description:
        'Extra tint of the theme background under the conversation column, in percent, 0–100 (0: only what the theme needs for readable text). Both are kept across theme changes; reset sets them to 0.',
    }),
  ),
  sceneFrameRate: Schema.optional(
    finite.annotate({
      description:
        'Frames per second an animated backdrop scene moves at, 0–30 (default 12; 0: a still picture). Each frame repaints the whole scene, so CPU use grows with it. Only the focused tab moves its backdrop. Kept across theme changes; reset restores 12.',
    }),
  ),
})

const hex = (description: string) => Schema.String.annotate({ description: `#rrggbb: ${description}.` })
// SAFETY: Object.fromEntries maps every role in `roles` to a String schema, exactly the mapped type asserted.
const roleFields = <const Roles extends readonly (keyof typeof ROLE_GUIDE)[]>(roles: Roles) =>
  Object.fromEntries(roles.map(role => [role, hex(ROLE_GUIDE[role])])) as { readonly [K in Roles[number]]: Schema.String }

const coloursSchema = Schema.Struct({ ...roleFields(NEUTRAL_ROLES), ...roleFields(ACCENT_ROLES) }).annotate({
  description:
    'Every role, in a ramp from bg to text: bg, panel, raised, selected are fills; line, border, borderStrong borders; strong, faint, muted, text glyphs and text. Prefer the theme’s official palette and UI colours over invented ones.',
})
// SAFETY: Object.fromEntries maps every syntax role to an optional String schema, exactly the mapped type asserted.
const syntaxSchema = Schema.Struct(
  Object.fromEntries(SYNTAX_ROLES.map(role => [role, Schema.optional(hex(ROLE_GUIDE[role]))])) as {
    readonly [K in (typeof SYNTAX_ROLES)[number]]: Schema.optional<Schema.String>
  },
).annotate({ description: 'Code colours; a missing role keeps the generated one.' })
const glassSchema = Schema.Struct({ blur: Schema.Number, tint: Schema.String, opacity: Schema.Number }).annotate({
  description: 'Frosted layer between the backdrop and the conversation column: blur 0–30 px, a #rrggbb tint, opacity 0–1.',
})
const backdropSchema = Schema.Struct({
  scene: Schema.optional(
    Schema.String.annotate({
      description: `A built-in animated scene painted at the back: ${SCENE_IDS.join(', ')}. Each is drawn for a light or a dark window (galleryThemes).`,
    }),
  ),
  glass: Schema.optional(glassSchema),
  layers: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description: `Up to ${MAX_BACKDROP_LAYERS} full-size layers over the scene, back to front; each is CSS declarations without braces, e.g. "background-image: radial-gradient(...); animation: snow 8s linear infinite". Gradients and animations only: url() and @import are refused. Animate opacity or transform, not backgrounds, so nothing repaints per frame; reduced motion stops the animations. A scene, layers and glass take at most 4 slots together.`,
    }),
  ),
  keyframes: Schema.optional(Schema.String.annotate({ description: 'The @keyframes blocks the layers use; prefix the names with the theme id.' })),
})
const schemeThemeSchema = Schema.Struct({ colours: coloursSchema, syntax: Schema.optional(syntaxSchema), backdrop: Schema.optional(backdropSchema) })

const themeDefinitionSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'Lowercase letters, digits and hyphens; not a preset id. Saving an existing id replaces that theme.' }),
  label: Schema.String.annotate({ description: 'Name shown to the user, 1–60 characters.' }),
  description: Schema.optional(Schema.String),
  dark: Schema.optional(schemeThemeSchema.annotate({ description: 'Colours used while DSH is dark.' })),
  light: Schema.optional(
    schemeThemeSchema.annotate({ description: 'Colours used while DSH is light. Give only the schemes the theme really has (its official variants).' }),
  ),
})

const themeDefineInputSchema = Schema.Struct({
  theme: themeDefinitionSchema,
  apply: Schema.optional(Schema.Boolean.annotate({ description: 'Switch to the theme at once (default true).' })),
})

const themeRemoveInputSchema = Schema.Struct({
  id: Schema.String,
  confirm: Schema.Literal(true).annotate({ description: 'Required: removing deletes the saved definition.' }),
})

export type ThemeState = typeof themeStateSchema.Type
export type ThemeSetInput = typeof themeSetInputSchema.Type
export type ThemeDefineInput = typeof themeDefineInputSchema.Type

const render = (state: ThemeState): string =>
  JSON.stringify({
    ...state,
    presets: state.presets.map(preset => preset.id),
    savedThemes: state.savedThemes.map(theme => theme.id),
    galleryThemes: state.galleryThemes.map(theme => `${theme.id} (${theme.schemes.join('+')})`),
  })

export const themeApi = defineApi({
  id: 'ui-theme-appearance',
  version: 1,
  owner: '@dshfiles/ui-styles',
  methods: {
    get: method({
      input: Schema.Struct({}),
      output: themeStateSchema,
      description:
        'The Appearance theme: preset or saved theme in use, the grey hue, grey tint, accent hue and contrast in effect and their overrides, UI, code and reading font, the light/dark preference, the presets, the saved themes and contrast warnings. Read-only.',
      tool: { name: 'theme_get', readOnly: true, render },
    }),
    set: method({
      input: themeSetInputSchema,
      output: themeStateSchema,
      description:
        'Change the Appearance theme for every surface: a preset, a saved theme, per-value overrides or the fonts; reset: true restores the defaults. Call only when the user asked to change the theme. Reversible: theme_get shows the previous state and reset: true returns to the defaults. Light or dark is the separate Theme setting (ui-theme preference).',
      tool: { name: 'theme_set', readOnly: false, render },
    }),
    define: method({
      input: themeDefineInputSchema,
      output: themeStateSchema,
      description:
        'Save a theme the user asked for (any named or described theme: Nord, Solarized, "a cyberpunk theme with rain") and, by default, switch to it, live with no restart. Look up the theme’s official palette first when it has one and keep its exact colours; give only the schemes it really has. An optional backdrop animates behind the conversation. Returns contrastWarnings for text under WCAG AA: tell the user. Call only when the user asked for a theme. Reversible: theme_set preset returns to a preset; theme_remove deletes it.',
      tool: { name: 'theme_define', readOnly: false, render },
    }),
    scene: method({
      input: Schema.Struct({ id: Schema.String }),
      output: Schema.Struct({ id: Schema.String, svg: Schema.String }),
      description: 'The SVG of a built-in backdrop scene, for the client that paints the active theme. Read-only; not an agent tool.',
    }),
    remove: method({
      input: themeRemoveInputSchema,
      output: themeStateSchema,
      description:
        'Delete a saved theme by id; if it was in use, the preset applies again. Call only when the user asked to delete that theme, with confirm: true. Irreversible except by defining it again.',
      tool: { name: 'theme_remove', readOnly: false, render },
    }),
  },
})
