/// <reference path="./css-modules.d.ts" />

export { defineClient, defineSlot } from './define.js'
export { declareLocaleNamespace, defineLocale } from './locale.js'
export {
  CLIENT_SLOT_REFERENCES,
  findClientSlot,
  slotOwnerImports,
  type ClientSlotReference,
} from './slot-reference.js'
export type {
  ClientConversationContribution,
  ClientDefinition,
  LocaleDefinition,
  LocaleDictionaries,
  LocaleKeyOf,
  PropsLocaleOf,
  SlotContribution,
  SlotOptions,
} from './types.js'
export { useApi, useApiQuery } from '../api/client.js'
export { useSettings } from '../settings/client.js'
export type { SettingsMutationState, SettingsReadError, SettingsState } from '../settings/types.js'
export type { HandleOf } from '@deepseek-ai/dsh-client-ui-slots'
export { defineClientPlugin } from '../sdk/client.js'
export type {
  ClientPluginApi,
  ClientPluginDefinition,
  ClientCapabilities,
  ClientCapability,
  UiApi,
  ComposerApi,
  ComposerActionDefinition,
  ComposerActionProps,
  PanelsApi,
  PanelDefinition,
  PanelHandle,
  PanelProps,
  PanelIconProps,
} from '../sdk/client.js'
