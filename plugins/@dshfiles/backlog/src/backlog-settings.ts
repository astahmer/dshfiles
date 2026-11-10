import { Settings } from '@dshfiles/dshx/effect/settings'
import { settingsShellSettings, type SettingsShellSettings } from '@dshfiles/settings-shell/settings'
import { backlogSettings, type BacklogSettings } from './settings.js'

export const BacklogSettingsTag = Settings.Tag<BacklogSettings>(backlogSettings.namespace)

/** The live settings of the `dshfiles-backlog` namespace. */
export const backlogSettingsLayer = Settings.layer(backlogSettings)

/** Schema defaults with `overrides`, for tests. */
export const backlogSettingsTestLayer = (overrides: Partial<BacklogSettings> = {}) =>
  Settings.layerTest<BacklogSettings>(backlogSettings.namespace, { ...backlogSettings.schema({}), ...overrides })

/** Settings-shell's namespace, which holds the one Jev key every Jev reader shares (docs/ade-ux §4.6). */
export const SharedJevSettingsTag = Settings.Tag<SettingsShellSettings>(settingsShellSettings.namespace)

/** The live shared key; schema defaults (an empty key) until settings-shell's namespace loads. */
export const sharedJevSettingsLayer = Settings.layer(settingsShellSettings)

/** A shared key for tests. */
export const sharedJevSettingsTestLayer = (jevSecret: string) =>
  Settings.layerTest<SettingsShellSettings>(settingsShellSettings.namespace, { ...settingsShellSettings.schema({}), jevSecret })
