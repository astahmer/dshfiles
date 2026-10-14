import { z } from 'zod'
import { aliasSchema, createMetadataSchema, environmentSchema, updateMetadataSchema } from './secret-arguments.js'

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

export const isSecretScope = (value: string): value is SecretMutationScope => value === 'global' || value === 'project' || value === 'local'

export const needsProjectFolder = (input: { readonly scope: SecretMutationScope; readonly hasProjectFolder: boolean }): boolean =>
  input.scope !== 'global' && !input.hasProjectFolder

const secretValueSchema = z.string().max(262_144, 'A secret value is at most 256 KiB.')

export const secretCreateFormSchema = createMetadataSchema
  .required()
  .extend({
    alias: aliasSchema,
    scope: z.enum(['global', 'project', 'local']),
    environment: environmentSchema,
    valueMode: z.enum(['generate', 'manual']),
    value: secretValueSchema,
    type: z.enum(['login', 'secure-note']),
  })
  .superRefine((form, context) => {
    if (form.valueMode === 'manual' && form.value.length === 0) context.addIssue({ code: 'custom', path: ['value'], message: 'Enter the secret value.' })
  })

export type SecretCreateFormValues = z.input<typeof secretCreateFormSchema>

export const secretCreateFormDefaults = (input: { readonly scope: SecretMutationScope; readonly environment: string }): SecretCreateFormValues => ({
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
export const defaultFieldForType = (type: SecretCreateFormValues['type']): string => (type === 'secure-note' ? 'notes' : 'password')

export const toSecretCreateInput = (form: SecretCreateFormValues): SecretCreateForm => ({
  alias: form.alias,
  scope: form.scope,
  environment: form.environment,
  valueMode: form.valueMode,
  value: form.valueMode === 'manual' ? form.value : null,
  type: form.type,
  ...(form.name.length === 0 ? {} : { name: form.name }),
  ...(form.source.length === 0 ? {} : { source: form.source }),
  ...(form.tags.length === 0 ? {} : { tags: form.tags }),
  ...(form.field.length === 0 ? {} : { field: form.field }),
})

export const secretUpdateFormSchema = updateMetadataSchema.required().extend({ renameTo: aliasSchema, clearTags: z.boolean(), value: secretValueSchema })

export type SecretUpdateFormValues = z.input<typeof secretUpdateFormSchema>

export const secretUpdateFormDefaults = (alias: string): SecretUpdateFormValues => ({
  renameTo: alias,
  name: '',
  source: '',
  tags: '',
  clearTags: false,
  value: '',
})

export const hasSecretUpdate = (input: { readonly alias: string; readonly form: SecretUpdateFormValues }): boolean =>
  input.form.name.length > 0 ||
  input.form.source.length > 0 ||
  input.form.tags.length > 0 ||
  input.form.clearTags ||
  input.form.value.length > 0 ||
  input.form.renameTo.trim() !== input.alias

export const toSecretUpdateInput = (input: {
  readonly target: { readonly alias: string; readonly scope: SecretMutationScope; readonly environment: string }
  readonly form: SecretUpdateFormValues
}): SecretUpdateForm => ({
  alias: input.target.alias,
  scope: input.target.scope,
  environment: input.target.environment,
  ...(input.form.renameTo.trim().length > 0 && input.form.renameTo.trim() !== input.target.alias ? { newAlias: input.form.renameTo.trim() } : {}),
  value: input.form.value.length === 0 ? null : input.form.value,
  ...(input.form.name.length === 0 ? {} : { name: input.form.name }),
  ...(input.form.source.length === 0 ? {} : { source: input.form.source }),
  ...(input.form.clearTags ? { tags: '' } : input.form.tags.length === 0 ? {} : { tags: input.form.tags }),
})
