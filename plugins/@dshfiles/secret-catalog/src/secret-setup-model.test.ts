import { describe, expect, it } from 'vitest'
import type { SecretMetadata } from './secret-metadata.js'
import type { SecretSetupDraft } from './secret-setup-model.js'
import { SecretSetupModel } from './secret-setup-model.js'

const row = (input: { readonly alias: string; readonly environment: string; readonly scope: SecretMetadata['scope'] }): SecretMetadata => ({
  id: `${input.scope}:${input.alias}:${input.environment}`,
  alias: input.alias,
  scope: input.scope,
  environment: input.environment,
  variableName: input.alias,
  item: '',
  field: '',
  service: '',
  description: '',
})

const validDraft: SecretSetupDraft = {
  alias: 'SYNTHETIC_TOKEN',
  environment: 'staging',
  scope: 'global',
  value: 'synthetic-secret-value',
}

describe('Secret Catalog setup draft', () => {
  it('starts with an editable alias suggestion and a blank masked value', () => {
    expect(SecretSetupModel.draftDefaults({ suggestedAlias: 'SYNTHETIC_TOKEN', environment: 'staging', scope: 'global' })).toEqual({
      alias: 'SYNTHETIC_TOKEN',
      environment: 'staging',
      scope: 'global',
      value: '',
    })
  })

  it('validates alias, environment, and a non-empty bounded value through the shared schemas', () => {
    expect(SecretSetupModel.draftSchema.safeParse({ ...validDraft, alias: '1BAD' }).success).toBe(false)
    expect(SecretSetupModel.draftSchema.safeParse({ ...validDraft, environment: 'bad env' }).success).toBe(false)
    expect(SecretSetupModel.draftSchema.safeParse({ ...validDraft, value: '' }).success).toBe(false)
    expect(SecretSetupModel.draftSchema.safeParse({ ...validDraft, value: 'x'.repeat(SecretSetupModel.valueLimit + 1) }).success).toBe(false)
  })

  it('requires a folder for project and local scope, but not global', () => {
    expect(SecretSetupModel.issue({ draft: { ...validDraft, scope: 'global' }, cwd: null, rows: [] })).toBeNull()
    expect(SecretSetupModel.issue({ draft: { ...validDraft, scope: 'project' }, cwd: null, rows: [] })).toBe('folder')
    expect(SecretSetupModel.issue({ draft: { ...validDraft, scope: 'local' }, cwd: '/tmp/project', rows: [] })).toBeNull()
  })

  it('rejects duplicate aliases only in the same environment, matching the Host create guard', () => {
    const existing = row({ alias: validDraft.alias, environment: validDraft.environment, scope: 'project' })
    expect(SecretSetupModel.issue({ draft: validDraft, cwd: '/tmp/project', rows: [existing] })).toBe('duplicate')
    expect(SecretSetupModel.issue({ draft: { ...validDraft, environment: 'prod' }, cwd: '/tmp/project', rows: [existing] })).toBeNull()
  })

  it('does not expose references for ambiguous aliases across scopes', () => {
    const sameAlias = [
      row({ alias: 'SYNTHETIC_TOKEN', environment: 'prod', scope: 'global' }),
      row({ alias: 'SYNTHETIC_TOKEN', environment: 'prod', scope: 'project' }),
      row({ alias: 'UNIQUE_TOKEN', environment: 'prod', scope: 'project' }),
    ]
    expect(SecretSetupModel.uniquelyBindableSecrets(sameAlias).map(secret => secret.alias)).toEqual(['UNIQUE_TOKEN'])
  })

  it('builds a manual create request with the selected scope, folder and environment', () => {
    expect(SecretSetupModel.createInput({ draft: { ...validDraft, scope: 'project' }, cwd: '/tmp/project' })).toEqual({
      alias: 'SYNTHETIC_TOKEN',
      cwd: '/tmp/project',
      scope: 'project',
      environment: 'staging',
      valueMode: 'manual',
      value: 'synthetic-secret-value',
    })
  })

  it('formats a reference without the default environment suffix', () => {
    expect(SecretSetupModel.reference({ alias: 'SYNTHETIC_TOKEN', environment: 'prod' })).toBe('secret:SYNTHETIC_TOKEN')
    expect(SecretSetupModel.reference({ alias: 'SYNTHETIC_TOKEN', environment: 'staging' })).toBe('secret:SYNTHETIC_TOKEN@staging')
  })
})
