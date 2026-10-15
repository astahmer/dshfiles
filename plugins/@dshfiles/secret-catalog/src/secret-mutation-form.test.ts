import { describe, expect, it } from 'vitest'
import type { SecretMetadata } from './secret-metadata.js'
import { SecretMutationForm, secretCreateFormSchema, secretUpdateFormSchema } from './secret-mutation-form.js'

const issuePaths = (result: {
  readonly success: boolean
  readonly error?: { readonly issues: readonly { readonly path: readonly PropertyKey[] }[] }
}): readonly string[] => result.error?.issues.map(issue => issue.path.join('.')) ?? []

describe('Secret Catalog create form', () => {
  it('rejects an invalid alias and a manual value that was never entered', () => {
    const result = secretCreateFormSchema.safeParse({
      ...SecretMutationForm.secretCreateFormDefaults({ scope: 'global', environment: 'prod' }),
      alias: '1BAD',
      valueMode: 'manual',
    })
    expect(issuePaths(result)).toEqual(['alias', 'value'])
  })

  it('reports a missing alias once instead of also failing its format', () => {
    const result = secretCreateFormSchema.safeParse(SecretMutationForm.secretCreateFormDefaults({ scope: 'global', environment: 'prod' }))
    expect(result.error?.issues.map(issue => issue.message)).toEqual(['Enter an alias.'])
  })

  it('accepts a generated value with the default environment', () => {
    expect(
      secretCreateFormSchema.safeParse({ ...SecretMutationForm.secretCreateFormDefaults({ scope: 'global', environment: 'prod' }), alias: 'SYNTHETIC_TOKEN' })
        .success,
    ).toBe(true)
  })

  it('rejects metadata that the CLI would read as another flag', () => {
    const result = secretCreateFormSchema.safeParse({
      ...SecretMutationForm.secretCreateFormDefaults({ scope: 'global', environment: 'prod' }),
      alias: 'SYNTHETIC',
      tags: '--force',
    })
    expect(issuePaths(result)).toEqual(['tags'])
  })

  it('keeps a generated value out of the request and omits blank metadata', () => {
    const input = SecretMutationForm.toSecretCreateInput({
      ...SecretMutationForm.secretCreateFormDefaults({ scope: 'project', environment: 'prod' }),
      alias: 'SYNTHETIC',
      value: 'stale',
      name: 'Synthetic item',
    })
    expect(input).toEqual({
      alias: 'SYNTHETIC',
      scope: 'project',
      environment: 'prod',
      valueMode: 'generate',
      value: null,
      type: 'login',
      field: 'password',
      name: 'Synthetic item',
    })
  })

  it('passes a manual value through unchanged', () => {
    const input = SecretMutationForm.toSecretCreateInput({
      ...SecretMutationForm.secretCreateFormDefaults({ scope: 'global', environment: 'prod' }),
      alias: 'SYNTHETIC',
      valueMode: 'manual',
      value: 'synthetic-value',
    })
    expect(input.value).toBe('synthetic-value')
  })

  it('writes the password field of a login and the notes of a Secure Note unless the field is changed', () => {
    const defaults = SecretMutationForm.secretCreateFormDefaults({ scope: 'global', environment: 'prod' })
    expect(defaults.field).toBe(SecretMutationForm.defaultFieldForType(defaults.type))
    expect(SecretMutationForm.defaultFieldForType('secure-note')).toBe('notes')
    expect(SecretMutationForm.toSecretCreateInput({ ...defaults, alias: 'SYNTHETIC', field: '' })).not.toHaveProperty('field')
  })

  it('requires a project folder for project and local scopes only', () => {
    expect(SecretMutationForm.needsProjectFolder({ scope: 'global', hasProjectFolder: false })).toBe(false)
    expect(SecretMutationForm.needsProjectFolder({ scope: 'project', hasProjectFolder: false })).toBe(true)
    expect(SecretMutationForm.needsProjectFolder({ scope: 'local', hasProjectFolder: true })).toBe(false)
  })
})

describe('Secret Catalog edit form', () => {
  const target = { alias: 'SYNTHETIC', scope: 'project', environment: 'prod' } as const

  const defaults = SecretMutationForm.secretUpdateFormDefaults(target.alias)

  it('has nothing to submit until a field changes', () => {
    expect(SecretMutationForm.hasSecretUpdate({ alias: target.alias, form: defaults })).toBe(false)
    expect(SecretMutationForm.hasSecretUpdate({ alias: target.alias, form: { ...defaults, clearTags: true } })).toBe(true)
    expect(SecretMutationForm.hasSecretUpdate({ alias: target.alias, form: { ...defaults, value: 'x' } })).toBe(true)
    expect(SecretMutationForm.hasSecretUpdate({ alias: target.alias, form: { ...defaults, renameTo: 'RENAMED' } })).toBe(true)
  })

  it('renames only when the trimmed alias differs', () => {
    expect(SecretMutationForm.toSecretUpdateInput({ target, form: { ...defaults, renameTo: ' SYNTHETIC ' } })).toEqual({ ...target, value: null })
    expect(SecretMutationForm.toSecretUpdateInput({ target, form: { ...defaults, renameTo: 'RENAMED' } })).toEqual({
      ...target,
      value: null,
      newAlias: 'RENAMED',
    })
  })

  it('rejects an invalid rename', () => {
    expect(issuePaths(secretUpdateFormSchema.safeParse({ ...defaults, renameTo: '1BAD' }))).toEqual(['renameTo'])
  })

  it('sends an empty tag list when clearing tags, whatever was typed', () => {
    const input = SecretMutationForm.toSecretUpdateInput({ target, form: { ...defaults, tags: 'kept', clearTags: true } })
    expect(input).toEqual({ ...target, value: null, tags: '' })
  })

  it('omits blank metadata and forwards a replacement value', () => {
    const input = SecretMutationForm.toSecretUpdateInput({ target, form: { ...defaults, source: 'https://example.invalid', value: 'synthetic-value' } })
    expect(input).toEqual({ ...target, value: 'synthetic-value', source: 'https://example.invalid' })
  })

  it('rejects metadata that starts with a dash', () => {
    expect(issuePaths(secretUpdateFormSchema.safeParse({ ...defaults, name: '-x' }))).toEqual(['name'])
  })
})

describe('Secret Catalog quick add', () => {
  const existing: SecretMetadata = {
    id: 'existing',
    alias: 'DB_PASSWORD',
    scope: 'project',
    environment: 'prod',
    variableName: 'DB_PASSWORD',
    item: '',
    field: '',
    service: '',
    description: '',
  }
  const draft = {
    name: 'STRIPE_KEY',
    value: 'synthetic-value',
    valueMode: 'manual',
    environment: 'prod',
    scope: 'project',
    hasProjectFolder: true,
    rows: [existing],
  } as const

  it('types names env-var style', () => {
    expect(SecretMutationForm.toEnvVarName('stripe api-key.v2')).toBe('STRIPE_API_KEY_V2')
    expect(SecretMutationForm.toEnvVarName('db_pässword!')).toBe('DB_PSSWORD')
  })

  it('adds to the viewed scope, or to the selected project under All', () => {
    expect(SecretMutationForm.defaultCreateScope({ filter: 'all', hasProjectFolder: true })).toBe('project')
    expect(SecretMutationForm.defaultCreateScope({ filter: 'all', hasProjectFolder: false })).toBe('global')
    expect(SecretMutationForm.defaultCreateScope({ filter: 'local', hasProjectFolder: true })).toBe('local')
  })

  it('names the first reason a draft cannot be saved', () => {
    expect(SecretMutationForm.quickAddIssue(draft)).toBeNull()
    expect(SecretMutationForm.quickAddIssue({ ...draft, name: '' })).toBe('name-required')
    expect(SecretMutationForm.quickAddIssue({ ...draft, name: '1PASSWORD' })).toBe('name-invalid')
    expect(SecretMutationForm.quickAddIssue({ ...draft, name: 'DB_PASSWORD' })).toBe('duplicate')
    expect(SecretMutationForm.quickAddIssue({ ...draft, name: 'DB_PASSWORD', environment: 'dev' })).toBeNull()
    expect(SecretMutationForm.quickAddIssue({ ...draft, hasProjectFolder: false })).toBe('needs-folder')
    expect(SecretMutationForm.quickAddIssue({ ...draft, value: '' })).toBe('value-required')
    expect(SecretMutationForm.quickAddIssue({ ...draft, value: '', valueMode: 'generate' })).toBeNull()
  })
})
