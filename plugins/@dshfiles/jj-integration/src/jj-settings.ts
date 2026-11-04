import { Settings } from '@dshfiles/dshx/effect/settings'
import { jjIntegrationSettings, type JjIntegrationSettings } from './settings.js'

/** The live `jj-integration` settings; a Host without the namespace runs on the schema defaults. */
export const JjSettings = Settings.Tag<JjIntegrationSettings>(jjIntegrationSettings.namespace)

export const JjSettingsLive = Settings.layer(jjIntegrationSettings)

/** In-memory settings over the schema defaults, for services tested without a Host. */
export const jjSettingsTest = (overrides: Partial<JjIntegrationSettings> = {}) =>
  Settings.layerTest<JjIntegrationSettings>(jjIntegrationSettings.namespace, { ...jjIntegrationSettings.schema({}), ...overrides })
