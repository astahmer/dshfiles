import { secretScopeSchemaEffect } from '@dshfiles/credential-port/effect'
import { Schema } from 'effect'
import { aliasSchema, SecretArgumentRules } from './secret-arguments.js'
import type { SecretScopeFilter } from './secret-catalog-model.js'
import type { SecretMetadata } from './secret-metadata.js'

export type SecretMutationScope = 'global' | 'project' | 'local'
export type SecretRemoveTarget = 'alias' | 'vault-item'

export interface SecretCreateForm {
  readonly alias: string
  readonly scope: SecretMutationScope
  readonly environment: string
  readonly valueMode: 'generate' | 'manual'
  readonly value: string | null
  readonly name?: string
  readonly source?: string
  readonly tags?: string
  readonly type?: string
  readonly field?: string
}

export interface SecretUpdateForm {
  readonly alias: string
  readonly scope: SecretMutationScope
  readonly environment: string
  readonly newAlias?: string
  readonly value: string | null
  readonly name?: string
  readonly source?: string
  readonly tags?: string
}

const isSecretScope = (value: string): value is SecretMutationScope => value === 'global' || value === 'project' || value === 'local'

const needsProjectFolder = (input: { readonly scope: SecretMutationScope; readonly hasProjectFolder: boolean }): boolean =>
  input.scope !== 'global' && !input.hasProjectFolder

/** Where a new secret goes when the user has not said: the scope being viewed, or the selected project under All. */
const defaultCreateScope = (input: { readonly filter: SecretScopeFilter; readonly hasProjectFolder: boolean }): SecretMutationScope => {
  if (input.filter !== 'all') return input.filter
  return input.hasProjectFolder ? 'project' : 'global'
}

/** Env-var style, as typed into the quick-add row: upper case, separators become `_`, other characters are dropped. */
const toEnvVarName = (raw: string): string =>
  raw
    .toUpperCase()
    .replace(/[\s.-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')

export type QuickAddIssue = 'name-required' | 'name-invalid' | 'duplicate' | 'needs-folder' | 'value-required'

/** The first reason a quick-add draft cannot be saved yet, or null when it can. */
const quickAddIssue = (input: {
  readonly name: string
  readonly value: string
  readonly valueMode: 'generate' | 'manual'
  readonly environment: string
  readonly scope: SecretMutationScope
  readonly hasProjectFolder: boolean
  readonly rows: readonly SecretMetadata[]
}): QuickAddIssue | null => {
  if (input.name.length === 0) return 'name-required'
  if (!Schema.is(aliasSchema)(input.name)) return 'name-invalid'
  if (input.rows.some(row => row.alias === input.name && row.environment === input.environment)) return 'duplicate'
  if (needsProjectFolder({ scope: input.scope, hasProjectFolder: input.hasProjectFolder })) return 'needs-folder'
  if (input.valueMode === 'manual' && input.value.length === 0) return 'value-required'
  return null
}

const metadataLimit = { name: 512, source: 2048, tags: 1024, field: 256 } as const

const secretValueIssue = (value: string): string | undefined => (value.length > 262_144 ? 'A secret value is at most 256 KiB.' : undefined)

/** One issue per broken field, collected together so the form flags every field that needs attention. */
const secretCreateFormEffectSchema = Schema.Struct({
  alias: Schema.String,
  scope: secretScopeSchemaEffect,
  environment: Schema.String,
  valueMode: Schema.Literals(['generate', 'manual']),
  value: Schema.String,
  type: Schema.Literals(['login', 'secure-note']),
  name: Schema.String,
  source: Schema.String,
  tags: Schema.String,
  field: Schema.String,
}).check(
  Schema.makeFilter(input => {
    const issues: Array<{ readonly path: ReadonlyArray<PropertyKey>; readonly issue: string }> = []
    const aliasMessage = SecretArgumentRules.aliasIssue(input.alias)
    if (aliasMessage !== undefined) issues.push({ path: ['alias'], issue: aliasMessage })
    const environmentMessage = SecretArgumentRules.environmentIssue(input.environment)
    if (environmentMessage !== undefined) issues.push({ path: ['environment'], issue: environmentMessage })
    const valueMessage = secretValueIssue(input.value)
    if (valueMessage !== undefined) issues.push({ path: ['value'], issue: valueMessage })
    else if (input.valueMode === 'manual' && input.value.length === 0) issues.push({ path: ['value'], issue: 'Enter the secret value.' })
    for (const field of ['name', 'source', 'tags', 'field'] as const) {
      const message = SecretArgumentRules.optionValueIssue(metadataLimit[field], input[field])
      if (message !== undefined) issues.push({ path: [field], issue: message })
    }
    return issues
  }),
)

export const secretCreateFormSchema = Schema.toStandardSchemaV1(secretCreateFormEffectSchema)

export type SecretCreateFormValues = typeof secretCreateFormEffectSchema.Type

const secretCreateFormDefaults = (input: { readonly scope: SecretMutationScope; readonly environment: string }): SecretCreateFormValues => ({
  alias: '',
  scope: input.scope,
  environment: input.environment,
  valueMode: 'generate',
  value: '',
  name: '',
  source: '',
  tags: '',
  type: 'login',
  field: 'password',
})

/** The value field the CLI should write for an item type: a Secure Note keeps its value in notes. */
const defaultFieldForType = (type: SecretCreateFormValues['type']): string => (type === 'secure-note' ? 'notes' : 'password')

const toSecretCreateInput = (form: SecretCreateFormValues): SecretCreateForm => ({
  alias: form.alias,
  scope: form.scope,
  environment: form.environment,
  valueMode: form.valueMode,
  value: form.valueMode === 'manual' ? form.value : null,
  type: form.type,
  ...(form.name.length !== 0 && { name: form.name }),
  ...(form.source.length !== 0 && { source: form.source }),
  ...(form.tags.length !== 0 && { tags: form.tags }),
  ...(form.field.length !== 0 && { field: form.field }),
})

const secretUpdateFormEffectSchema = Schema.Struct({
  renameTo: Schema.String,
  name: Schema.String,
  source: Schema.String,
  tags: Schema.String,
  clearTags: Schema.Boolean,
  value: Schema.String,
}).check(
  Schema.makeFilter(input => {
    const issues: Array<{ readonly path: ReadonlyArray<PropertyKey>; readonly issue: string }> = []
    const renameMessage = SecretArgumentRules.aliasIssue(input.renameTo)
    if (renameMessage !== undefined) issues.push({ path: ['renameTo'], issue: renameMessage })
    const valueMessage = secretValueIssue(input.value)
    if (valueMessage !== undefined) issues.push({ path: ['value'], issue: valueMessage })
    for (const field of ['name', 'source', 'tags'] as const) {
      const message = SecretArgumentRules.optionValueIssue(metadataLimit[field], input[field])
      if (message !== undefined) issues.push({ path: [field], issue: message })
    }
    return issues
  }),
)

export const secretUpdateFormSchema = Schema.toStandardSchemaV1(secretUpdateFormEffectSchema)

export type SecretUpdateFormValues = typeof secretUpdateFormEffectSchema.Type

const secretUpdateFormDefaults = (alias: string): SecretUpdateFormValues => ({
  renameTo: alias,
  name: '',
  source: '',
  tags: '',
  clearTags: false,
  value: '',
})

const hasSecretUpdate = (input: { readonly alias: string; readonly form: SecretUpdateFormValues }): boolean =>
  input.form.name.length > 0 ||
  input.form.source.length > 0 ||
  input.form.tags.length > 0 ||
  input.form.clearTags ||
  input.form.value.length > 0 ||
  input.form.renameTo.trim() !== input.alias

const toSecretUpdateInput = (input: {
  readonly target: { readonly alias: string; readonly scope: SecretMutationScope; readonly environment: string }
  readonly form: SecretUpdateFormValues
}): SecretUpdateForm => ({
  alias: input.target.alias,
  scope: input.target.scope,
  environment: input.target.environment,
  ...(input.form.renameTo.trim().length > 0 && input.form.renameTo.trim() !== input.target.alias && { newAlias: input.form.renameTo.trim() }),
  value: input.form.value.length === 0 ? null : input.form.value,
  ...(input.form.name.length !== 0 && { name: input.form.name }),
  ...(input.form.source.length !== 0 && { source: input.form.source }),
  ...(input.form.clearTags ? { tags: '' } : input.form.tags.length === 0 ? {} : { tags: input.form.tags }),
})

export class SecretMutationForm {
  static readonly isSecretScope = isSecretScope
  static readonly needsProjectFolder = needsProjectFolder
  static readonly defaultCreateScope = defaultCreateScope
  static readonly toEnvVarName = toEnvVarName
  static readonly quickAddIssue = quickAddIssue
  static readonly secretCreateFormDefaults = secretCreateFormDefaults
  static readonly defaultFieldForType = defaultFieldForType
  static readonly toSecretCreateInput = toSecretCreateInput
  static readonly secretUpdateFormDefaults = secretUpdateFormDefaults
  static readonly hasSecretUpdate = hasSecretUpdate
  static readonly toSecretUpdateInput = toSecretUpdateInput
}
