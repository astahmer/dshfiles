import { Api, DshxPlugin, hostService } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { Effect, Option } from 'effect'
import { themeApi } from './api.js'
import { appearanceSettings, UI_STYLES_SETTINGS_NAMESPACE } from './settings.js'
import { nextAppearance, normaliseAppearance, themeState } from './theme-state.js'

type AppearanceValue = SettingsValue<typeof appearanceSettings.schema>
const AppearanceSettings = Settings.Tag<AppearanceValue>(UI_STYLES_SETTINGS_NAMESPACE)

/** The Host's light/dark preference (`ui-theme.preference`), reported by `theme_get`; never written here. */
const readScheme = Effect.gen(function* () {
  const forms = yield* Effect.option(hostService('settings'))
  if (Option.isNone(forms)) return 'unknown'
  const row = forms.value.describe().find(item => item.ns === 'ui-theme')
  const value: unknown = row?.value
  const preference = typeof value === 'object' && value !== null && 'preference' in value ? value.preference : undefined
  return typeof preference === 'string' ? preference : 'unknown'
}).pipe(Effect.catchCause(() => Effect.succeed('unknown')))

/**
 * Host half of the theme owner (visual refresh T6.1–T6.3): the Appearance settings namespace and the
 * `theme_get` / `theme_set` agent tools. The Client half (`client.ts`) applies the same settings to the page.
 */
export default DshxPlugin.make({
  name: '@dshfiles/ui-styles',
  settings: [appearanceSettings],
  layer: Settings.layer(appearanceSettings),
  apis: [
    Api.bind(themeApi, {
      get: () =>
        Effect.gen(function* () {
          const settings = yield* AppearanceSettings
          const value = yield* settings.get
          return themeState(normaliseAppearance(value), yield* readScheme)
        }),
      set: input =>
        Effect.gen(function* () {
          const settings = yield* AppearanceSettings
          const snapshot = yield* settings.snapshot
          const next = nextAppearance(normaliseAppearance(snapshot.value), input)
          // Decoding through the contract validates the value and gives it the stored type; unset overrides stay absent.
          yield* settings.replace(appearanceSettings.schema(next), snapshot.revision)
          return themeState(next, yield* readScheme)
        }),
    }),
  ],
})
