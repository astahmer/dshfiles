import { describe, expect, it } from 'vitest'
import {
  hasSecretUpdate,
  needsProjectFolder,
  secretCreateFormDefaults,
  secretCreateFormSchema,
  secretUpdateFormDefaults,
  secretUpdateFormSchema,
  toSecretCreateInput,
  toSecretUpdateInput,
} from './secret-mutation-form.js'

const issuePaths = (result: {
  readonly success: boolean
  readonly error?: { readonly issues: readonly { readonly path: readonly PropertyKey[] }[] }
}): readonly string[] => result.error?.issues.map(issue => issue.path.join('.')) ?? []

describe('Secret Catalog create form', () => {
  it('rejects an invalid alias and a manual value that was never entered', () => {
    const result = secretCreateFormSchema.safeParse({ ...secretCreateFormDefaults('global'), alias: '1BAD', valueMode: 'manual' })
    expect(issuePaths(result)).toEqual(['alias', 'value'])
  })

  it('accepts a generated value with the default environment', () => {
    expect(secretCreateFormSchema.safeParse({ ...secretCreateFormDefaults('global'), alias: 'SYNTHETIC_TOKEN' }).success).toBe(true)
  })

  it('rejects metadata that the CLI would read as another flag', () => {
    const result = secretCreateFormSchema.safeParse({ ...secretCreateFormDefaults('global'), alias: 'SYNTHETIC', tags: '--force' })
    expect(issuePaths(result)).toEqual(['tags'])
  })

  it('keeps a generated value out of the request and omits blank metadata', () => {
    const input = toSecretCreateInput({ ...secretCreateFormDefaults('project'), alias: 'SYNTHETIC', value: 'stale', name: 'Synthetic item' })
    expect(input).toEqual({
      alias: 'SYNTHETIC',
      scope: 'project',
      environment: 'prod',
      valueMode: 'generate',
      value: null,
      type: 'login',
      name: 'Synthetic item',
    })
  })

  it('passes a manual value through unchanged', () => {
    const input = toSecretCreateInput({ ...secretCreateFormDefaults('global'), alias: 'SYNTHETIC', valueMode: 'manual', value: 'synthetic-value' })
    expect(input.value).toBe('synthetic-value')
  })

  it('requires a project folder for project and local scopes only', () => {
    expect(needsProjectFolder({ scope: 'global', hasProjectFolder: false })).toBe(false)
    expect(needsProjectFolder({ scope: 'project', hasProjectFolder: false })).toBe(true)
    expect(needsProjectFolder({ scope: 'local', hasProjectFolder: true })).toBe(false)
  })
})

describe('Secret Catalog edit form', () => {
  const target = { alias: 'SYNTHETIC', scope: 'project', environment: 'prod' } as const

  it('has nothing to submit until a field changes', () => {
    expect(hasSecretUpdate(secretUpdateFormDefaults)).toBe(false)
    expect(hasSecretUpdate({ ...secretUpdateFormDefaults, clearTags: true })).toBe(true)
    expect(hasSecretUpdate({ ...secretUpdateFormDefaults, value: 'x' })).toBe(true)
  })

  it('sends an empty tag list when clearing tags, whatever was typed', () => {
    const input = toSecretUpdateInput({ target, form: { ...secretUpdateFormDefaults, tags: 'kept', clearTags: true } })
    expect(input).toEqual({ ...target, value: null, tags: '' })
  })

  it('omits blank metadata and forwards a replacement value', () => {
    const input = toSecretUpdateInput({ target, form: { ...secretUpdateFormDefaults, source: 'https://example.invalid', value: 'synthetic-value' } })
    expect(input).toEqual({ ...target, value: 'synthetic-value', source: 'https://example.invalid' })
  })

  it('rejects metadata that starts with a dash', () => {
    expect(issuePaths(secretUpdateFormSchema.safeParse({ ...secretUpdateFormDefaults, name: '-x' }))).toEqual(['name'])
  })
})
