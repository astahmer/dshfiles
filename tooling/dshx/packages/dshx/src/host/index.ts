export { defineCommand, defineHost, definePromptContext, definePromptSection } from './define.js'
export { defineTool } from '@deepseek-ai/dsh-tools'
export type { HostDefinition, PromptContextContribution, PromptContribution, PromptSectionContribution } from './types.js'
export type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
export type { CommandResult } from '@deepseek-ai/dsh-commands/types'
export type { AssembleContext, PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'
export type { Context } from '@deepseek-ai/cordis'
export { definePlugin } from '../sdk/host.js'
export type { PluginApi, PluginDefinition, HostCapabilities, HostCapability } from '../sdk/host.js'
export type { BasePluginApi, EventsApi, LifecycleApi } from '../sdk/lifecycle.js'
// The cordis `Events` augmentation lives in the DSH packages, not in cordis.
// Without re-exporting one of them, a plugin that imports `defineHost` from here
// resolves `ctx.on` against a bare `Events` and every DSH event name is
// rejected. This is a type-only re-export: no runtime specifier is emitted.
export type {} from '@deepseek-ai/dsh-llm'
export type {} from '@deepseek-ai/dsh-tools'
export type {} from '@deepseek-ai/dsh-system-prompt'

export { waitForManagedExit, terminateManagedProcess } from './process.js'
