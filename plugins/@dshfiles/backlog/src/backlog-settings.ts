import { Settings } from '@dshfiles/dshx/effect/settings'
import { backlogSettings, type BacklogSettings } from './settings.js'

export const BacklogSettingsTag = Settings.Tag<BacklogSettings>(backlogSettings.namespace)

/** The live settings of the `dshfiles-backlog` namespace. */
export const backlogSettingsLayer = Settings.layer(backlogSettings)

/** Schema defaults with `overrides`, for tests. */
export const backlogSettingsTestLayer = (overrides: Partial<BacklogSettings> = {}) =>
  Settings.layerTest<BacklogSettings>(backlogSettings.namespace, { ...backlogSettings.schema({}), ...overrides })
