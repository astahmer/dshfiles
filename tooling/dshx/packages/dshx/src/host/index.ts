import { HostDefinitionModel } from './define.js'

export const defineCommand = HostDefinitionModel.defineCommand
export const defineHost = HostDefinitionModel.define
export const definePromptContext = HostDefinitionModel.definePromptContext
export const definePromptSection = HostDefinitionModel.definePromptSection
export { defineTool } from '@deepseek-ai/dsh-tools'
import { HostApiClientModel } from '../api/host-client.js'
import { HostApiEventsModel } from '../api/host-events.js'
import { PluginStorageModel } from './plugin-storage.js'
import { ReloadTransactionModel } from './outside-reload.js'

export const createHostApiClient = HostApiClientModel.create
export const isApiServed = HostApiClientModel.isServed
export const listApis = HostApiClientModel.list
/** Send a declared API event to every connected browser; see `useApiEvent`. */
export const publishApiEvent = HostApiEventsModel.publish
/** Durable key-value storage for one plugin namespace, shared with its browser half through `hostStorage(api)`. */
export const pluginStorage = PluginStorageModel.open
export type { PluginStorage } from './plugin-storage.js'
/** One model call outside any thread, with optional schema-checked JSON output. */
export { generate } from './generate.js'
export type { GenerateInput, GenerateModel, GenerateResult } from './generate.js'
export type { ToolEdit } from './tool-edits.js'
export type { HostHooks, ShellEnvHook } from './hooks.js'
export type { HostRegistrations, ModelDiscoveryContribution, ProviderContribution } from './registrations.js'
export type { HostDefinition, HostToolContribution, PromptContextContribution, PromptContribution, PromptSectionContribution } from './types.js'
export type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
export type { CommandResult } from '@deepseek-ai/dsh-commands/types'
export type { AssembleContext, PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'
export type { Context } from '@deepseek-ai/cordis'
export { definePlugin, type HostCapabilities, type HostCapability, type PluginApi, type PluginDefinition } from '../sdk/host.js'
export type { BasePluginApi, EventsApi, LifecycleApi } from '../sdk/lifecycle.js'
// The cordis `Events` augmentation lives in the DSH packages, not in cordis.
// Without re-exporting one of them, a plugin that imports `defineHost` from here
// resolves `ctx.on` against a bare `Events` and every DSH event name is
// rejected. This is a type-only re-export: no runtime specifier is emitted.
export type {} from '@deepseek-ai/dsh-llm'
export type {} from '@deepseek-ai/dsh-tools'
export type {} from '@deepseek-ai/dsh-system-prompt'

export { waitForManagedExit, terminateManagedProcess } from './process.js'
export const runOutsideReload = ReloadTransactionModel.runOutside
export const scheduleOutsideReload = ReloadTransactionModel.schedule
export { readWebStartupOverrides } from './web-startup.js'
