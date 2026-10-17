import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { HostDefinition, PromptContextContribution, PromptContribution, PromptSectionContribution } from './types.js'

export type PromptContributionParts = { readonly kind: 'section'; readonly value: PromptSection } | { readonly kind: 'context'; readonly value: PromptContext }

const promptContributions = new WeakMap<object, PromptContributionParts>()

/** Preserve a Host definition exactly while providing contextual types. */
function defineHost<const ConfigSchema extends StandardSchemaV1, const T extends HostDefinition<ConfigSchema>>(
  definition: T & { readonly Config: ConfigSchema } & HostDefinition<ConfigSchema> & Record<Exclude<keyof T, keyof HostDefinition<ConfigSchema>>, never>,
): T
function defineHost<const T extends HostDefinition>(definition: T & Record<Exclude<keyof T, keyof HostDefinition>, never>): T
function defineHost<const T>(definition: T): T {
  return definition
}

/** Preserve the exact official Command definition without changing its runtime contract. */
function defineCommand<const T extends CommandDefinition>(definition: T): T {
  return definition
}

/** Preserve an official PromptSection while tagging its registration method. */
function definePromptSection<const T extends PromptSection>(section: T): PromptSectionContribution<T> {
  const contribution = {} as PromptSectionContribution<T>
  promptContributions.set(contribution, { kind: 'section', value: section })
  return contribution
}

/** Preserve an official PromptContext while tagging its registration method. */
function definePromptContext<const T extends PromptContext>(context: T): PromptContextContribution<T> {
  const contribution = {} as PromptContextContribution<T>
  promptContributions.set(contribution, { kind: 'context', value: context })
  return contribution
}

function promptContributionKind(value: unknown): 'section' | 'context' | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return promptContributions.get(value)?.kind
}

function promptContributionParts(value: PromptContribution): PromptContributionParts {
  const parts = promptContributions.get(value)
  if (parts === undefined) throw new TypeError('Invalid Prompt contribution; create it with definePromptSection() or definePromptContext().')
  return parts
}

export class HostDefinitionModel {
  static readonly define = defineHost
  static readonly defineCommand = defineCommand
  static readonly definePromptSection = definePromptSection
  static readonly definePromptContext = definePromptContext
  static readonly promptContributionKind = promptContributionKind
  static readonly promptContributionParts = promptContributionParts
}
