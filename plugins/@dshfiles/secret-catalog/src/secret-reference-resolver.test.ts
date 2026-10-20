import { describe, expect, it } from 'vitest'
import type { SecretMetadata } from './secret-metadata.js'
import { createSecretCatalogValues } from './secret-reference-resolver.js'
import type { SecretCatalogOperations } from './secret-operations.js'

const row = (overrides: Partial<SecretMetadata>): SecretMetadata => ({
  id: 'row',
  alias: 'TOKEN',
  scope: 'global',
  environment: 'prod',
  variableName: 'TOKEN',
  item: 'Item',
  field: 'password',
  service: 'example.test',
  description: '',
  ...overrides,
})

const valuesWith = (rows: readonly SecretMetadata[]) => {
  const calls: { alias: string; scope: string; cwd: string | null; environment: string | undefined }[] = []
  const operations: Pick<SecretCatalogOperations, 'list' | 'reveal'> = {
    list: async () => rows,
    reveal: async (alias, scope, cwd, environment) => {
      calls.push({ alias, scope, cwd, environment })
      return 'resolved-secret-value'
    },
  }
  return { values: createSecretCatalogValues({ operations }), calls }
}

describe('secret reference resolution', () => {
  it('resolves the matching row with its own scope and environment', async () => {
    const fixture = valuesWith([row({}), row({ alias: 'OTHER' })])
    const value = await fixture.values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: null })
    expect(value).toBe('resolved-secret-value')
    expect(fixture.calls).toEqual([{ alias: 'TOKEN', scope: 'global', cwd: null, environment: 'prod' }])
  })

  it('resolves a project alias through the caller folder', async () => {
    const fixture = valuesWith([row({ scope: 'project', environment: 'dev' })])
    await fixture.values.resolve({ reference: { alias: 'TOKEN', environment: 'dev' }, cwd: '/tmp/project' })
    expect(fixture.calls).toEqual([{ alias: 'TOKEN', scope: 'project', cwd: '/tmp/project', environment: 'dev' }])
  })

  it('names the alias and environment when nothing matches, without revealing', async () => {
    const fixture = valuesWith([row({ environment: 'prod' })])
    await expect(fixture.values.resolve({ reference: { alias: 'TOKEN', environment: 'dev' }, cwd: null })).rejects.toThrow(
      'No secret alias TOKEN is configured for environment dev.',
    )
    expect(fixture.calls).toEqual([])
  })

  it('refuses a duplicate alias rather than guessing its scope', async () => {
    const fixture = valuesWith([row({ scope: 'global' }), row({ scope: 'project' })])
    await expect(fixture.values.resolve({ reference: { alias: 'TOKEN', environment: 'prod' }, cwd: '/tmp/project' })).rejects.toThrow(
      'exists in several scopes',
    )
    expect(fixture.calls).toEqual([])
  })
})
