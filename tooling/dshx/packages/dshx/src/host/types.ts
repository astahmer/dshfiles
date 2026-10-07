import type { Context, Effect } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { AnyApiMethodDefinition, ApiHostRegistration } from '../api/types.js'
import type { SettingsContribution } from '../settings/types.js'

/** A system-prompt section wrapped only to preserve its registration kind. */
declare const promptContributionBrand: unique symbol

export interface PromptSectionContribution<Section extends PromptSection = PromptSection> {
  readonly [promptContributionBrand]: {
    readonly kind: 'section'
    readonly value: Section
  }
}

/** Dynamic runtime context wrapped only to preserve its registration kind. */
export interface PromptContextContribution<Prompt extends PromptContext = PromptContext> {
  readonly [promptContributionBrand]: {
    readonly kind: 'context'
    readonly value: Prompt
  }
}

/** One official system-prompt contribution registered by a DSHX Host. */
export type PromptContribution = PromptSectionContribution | PromptContextContribution

/** Author-facing Host definition backed by the official Cordis context and Tool model. */
export interface HostDefinition<ConfigSchema extends StandardSchemaV1 = StandardSchemaV1> {
  readonly name?: string
  readonly inject?: readonly string[]
  readonly tools?: readonly ToolDefinition[]
  readonly commands?: readonly CommandDefinition[]
  readonly prompts?: readonly PromptContribution[]
  /** Native Loader Config schema for profile-owned fields that are not DSHX Settings. */
  readonly Config?: ConfigSchema
  readonly settings?: readonly SettingsContribution[]
  readonly apis?: readonly ApiHostRegistration<Record<string, AnyApiMethodDefinition>, any>[]
  readonly setup?: (ctx: Context, config: StandardSchemaV1.InferOutput<ConfigSchema>) => void | Effect<void>
}
