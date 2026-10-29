import { SettingsDefinitionModel } from './define.js'

export const defineSettings = SettingsDefinitionModel.define
export type { SettingsDefinition } from './define.js'
export type {
  SettingsClientOptions,
  SettingsContract,
  SettingsContribution,
  SettingsHostContribution,
  SettingsHostOptions,
  SettingsMutationState,
  SettingsReadError,
  SettingsReadErrorKind,
  SettingsSecretState,
  SettingsState,
  SettingsValue,
} from './types.js'
export type { SettingsScope } from './protocol-2.js'
export { settingsSearchEntriesSchema, settingsSearchEntrySchema, settingsSectionMetadataSchema } from './section-entries-schema.js'
export type { SettingsSearchEntry, SettingsSectionMetadata, SettingsSectionSearchProps } from './section-entries.js'
