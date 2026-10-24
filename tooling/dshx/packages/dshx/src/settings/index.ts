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
