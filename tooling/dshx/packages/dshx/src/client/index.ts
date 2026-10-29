import { SettingsPageRendererModel, type SettingsPageRenderer, type SettingsPageRendererProps } from '../settings/page-renderer.js'
import { SettingsSearchEntriesModel } from '../settings/section-entries.js'
import { ApiRuntimeModel } from '../api/runtime.js'
import { ClientContributionModel } from './define.js'
import { HostCommandsModel } from './host-commands.js'
import { LocaleNamespaceModel } from './locale.js'
import { BrowserBroker } from './broker.js'
import { PluginHooksModel } from './hooks.js'
import { PluginContextModel } from './plugin-context.js'
import { StoreModel } from './store.js'

export const defineClient = ClientContributionModel.defineClient
export const defineSlot = ClientContributionModel.defineSlot
export const declareLocaleNamespace = LocaleNamespaceModel.declareNamespace
export const defineLocale = LocaleNamespaceModel.define
export const plural = LocaleNamespaceModel.plural
export { CLIENT_SLOT_REFERENCES, type ClientSlotReference } from 'create-dshx/slot-capabilities'
export { findClientSlot, slotOwnerImports } from './slot-reference.js'
export const hasHostCommandRegistry = HostCommandsModel.hasRegistry
export const runHostCommand = HostCommandsModel.run
export type {
  ClientConversationContribution,
  ClientContext,
  ClientDefinition,
  ClientServiceMap,
  LocaleDefinition,
  LocaleDictionaries,
  LocaleKeyOf,
  LocaleSourceDictionaries,
  PluralKeyOf,
  PropsLocaleOf,
  SlotContribution,
  SlotOptions,
} from './types.js'
export { useApi, useApiEvent, useApiQuery } from '../api/client.js'
import { ApiClientEventsModel } from '../api/client-events.js'
/** Follow a Host-published API event outside React; see `useApiEvent`. */
export const subscribeApiEvent = ApiClientEventsModel.subscribe
export const createApiClient = ApiRuntimeModel.createClient
/** Call a dshx API discovered through `dshxRegistryApi` without importing its contract. */
export const createRegisteredApiClient = ApiRuntimeModel.createRegisteredClient
export type { RegisteredApiSpec } from '../api/runtime.js'
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

export const defineContract = BrowserBroker.defineContract
export const defineRegistry = BrowserBroker.defineRegistry
/** Contributions that threw, for a diagnostics view; `useContributionFailures` reads it in React. */
export const contributionFailures = BrowserBroker.failures
export type { ContractToken, ContributionFailure, Live, RegistryToken, Subscribable } from './broker.js'
export type { ItemSource, PluginContext, PluginServices, Track } from './plugin-context.js'
export type { ClientOs } from './types.js'
export const constantSource = PluginContextModel.constant
export const createSource = PluginContextModel.signal

export { CommandChords } from './command-chords.js'
export { Command, Composer, Dialogs, SessionScreen, Toasts } from './app-services.js'
export { LinkHandler, MarkdownLinks } from './links.js'
export { Browser, Changes, Files } from './app-contracts.js'
export type { BrowserService, ChangesService, FilesListing, FilesService } from './app-contracts.js'
export type { LinkHandlerItem, LinkTarget } from './links.js'
export type {
  AlertInput,
  AppearanceState,
  CommandItem,
  CommandsService,
  ComposerAttachment,
  ComposerModelSelection,
  ComposerService,
  ComposerTarget,
  ConfirmInput,
  DialogsService,
  EnvironmentService,
  LayoutService,
  SideRegionService,
  LocaleState,
  NotificationPermissionState,
  NotificationsService,
  NotifyInput,
  PromptInput,
  SaveFileInput,
  SelectInput,
  SelectOption,
  SessionScreenService,
  SystemService,
  TextDirection,
  ToastInput,
  ToastsService,
  ToastTone,
  WorkspaceEntry,
  WorkspaceFilesService,
  WorkspaceFilesState,
  WorkspaceSearchHit,
} from './app-services.js'
export {
  ComposerAction,
  ComposerPill,
  FileViewer,
  HeaderAction,
  MenuItem,
  Overlay,
  Panel,
  PluginDetailBadge,
  PluginDetailSection,
  SessionRowAccessory,
  SettingsSection,
} from './registries.js'
export type {
  ComposerActionItem,
  ComposerPillItem,
  ComposerPillRow,
  ComposerPillState,
  FileViewerItem,
  FileViewerProps,
  HeaderActionItem,
  MenuRowItem,
  OverlayItem,
  PanelItem,
  PluginDetailItem,
  PluginDetailProps,
  PluginDetailSubject,
  SessionRowAccessoryItem,
  SettingsSectionItem,
} from './registries.js'

export const defineStore = StoreModel.define
export type { DefinedStore, PersistedStore, StoreDefinition, StoreScope } from './store.js'
export type { DefinedHostStore, HostStore, HostStoreDefinition, StorageService } from './host-storage.js'

export const usePlugin = PluginHooksModel.usePlugin
export const useSubscribable = PluginHooksModel.useSubscribable
export const useContract = PluginHooksModel.useContract
export const useRegistry = PluginHooksModel.useRegistry
export const useContributionFailures = PluginHooksModel.useContributionFailures
export const useKeyed = PluginHooksModel.useKeyed
export const useLatest = PluginHooksModel.useLatest
export type { LatestState } from './hooks.js'

export const provideSettingsPageRenderer = SettingsPageRendererModel.provide
export type { SettingsPageRenderer, SettingsPageRendererProps }

/** Search entries every live `settings.section` publishes, read by a Settings shell without mounting the sections. */
export const settingsSearchEntries = SettingsSearchEntriesModel.current
export const subscribeSettingsSearchEntries = SettingsSearchEntriesModel.subscribe
/** For a section registered imperatively through `ctx.slots.register`, which the `metadata` option never reaches. */
export const publishSettingsSearchEntries = SettingsSearchEntriesModel.publish
export type { SettingsSearchEntriesBySection, SettingsSearchEntry, SettingsSectionMetadata, SettingsSectionSearchProps } from '../settings/section-entries.js'
