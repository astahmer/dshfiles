import { Settings } from '@dshfiles/dshx/effect/settings'
import { projectAutomationsSettings, type ProjectAutomationsSettings } from './settings.js'

export const ProjectAutomationsSettingsTag = Settings.Tag<ProjectAutomationsSettings>(projectAutomationsSettings.namespace)

/** The live settings of the `dshfiles-project-automations` namespace. */
export const projectAutomationsSettingsLayer = Settings.layer(projectAutomationsSettings)

/** Schema defaults with `overrides`, for tests. */
export const projectAutomationsSettingsTestLayer = (overrides: Partial<ProjectAutomationsSettings> = {}) =>
  Settings.layerTest<ProjectAutomationsSettings>(projectAutomationsSettings.namespace, { ...projectAutomationsSettings.schema({}), ...overrides })
