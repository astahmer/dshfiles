import { describe, expect, it } from 'vitest'
import {
  formatSecretReference,
  parseSecretReference,
  secretReferenceSchema,
  SecretReferenceResolver,
  type SecretReferenceResolution,
} from './secret-reference.js'

describe('secret references', () => {
  it('parses an alias and defaults its environment to prod', () => {
    expect(parseSecretReference('secret:OPENCODE_GO_API_KEY')).toEqual({ alias: 'OPENCODE_GO_API_KEY', environment: 'prod' })
  })

  it('parses an explicit environment and ignores surrounding whitespace', () => {
    expect(parseSecretReference('  secret:DB_PASSWORD@dev  ')).toEqual({ alias: 'DB_PASSWORD', environment: 'dev' })
  })

  it('rejects anything that is not a reference, so a field can still hold prose', () => {
    for (const text of ['', 'OPENCODE_GO_API_KEY', 'secret:', 'secret:1BAD', 'secret:A B', 'secret:A@', 'env:FOO', 'secret:A@b@c']) {
      expect(parseSecretReference(text)).toBeNull()
    }
  })

  it('formats without the default environment and round-trips every reference', () => {
    expect(formatSecretReference({ alias: 'A', environment: 'prod' })).toBe('secret:A')
    expect(formatSecretReference({ alias: 'A', environment: 'dev' })).toBe('secret:A@dev')
    for (const text of ['secret:A', 'secret:A@dev', 'secret:A-B_1@prod-eu']) {
      const parsed = parseSecretReference(text)
      expect(parsed === null ? null : formatSecretReference(parsed)).toBe(text)
    }
  })

  it('validates a reference schema into its alias and environment', () => {
    expect(secretReferenceSchema.parse('secret:TOKEN@staging')).toEqual({ alias: 'TOKEN', environment: 'staging' })
    expect(secretReferenceSchema.safeParse('TOKEN').success).toBe(false)
  })
})

describe('SecretReferenceResolver', () => {
  const resolving = (value: string, calls: SecretReferenceResolution[] = []) => ({
    resolve: async (input: SecretReferenceResolution) => {
      calls.push(input)
      return value
    },
  })

  it('resolves a bound reference on the Host and asks for no folder', async () => {
    const calls: SecretReferenceResolution[] = []
    await expect(
      SecretReferenceResolver.resolve({ referenceText: 'secret:API_KEY@dev', values: resolving('resolved-secret', calls), environmentValue: 'env-key' }),
    ).resolves.toBe('resolved-secret')
    expect(calls).toEqual([{ reference: { alias: 'API_KEY', environment: 'dev' }, cwd: null }])
  })

  it('returns safe labels with the resolved credential, never with the value in the label', async () => {
    const referenceCalls: SecretReferenceResolution[] = []
    await expect(
      SecretReferenceResolver.resolveWithLabel({
        referenceText: ' secret:API_KEY@dev ',
        values: resolving('super-secret-value', referenceCalls),
        environmentValue: undefined,
        environmentVariableName: 'TYPESAFE_API_KEY',
      }),
    ).resolves.toEqual({ value: 'super-secret-value', label: 'secret:API_KEY@dev' })
    expect(referenceCalls).toEqual([{ reference: { alias: 'API_KEY', environment: 'dev' }, cwd: null }])

    await expect(
      SecretReferenceResolver.resolveWithLabel({
        referenceText: '  ',
        values: undefined,
        environmentValue: 'another-secret-value',
        environmentVariableName: 'TYPESAFE_API_KEY',
      }),
    ).resolves.toEqual({ value: 'another-secret-value', label: 'env:TYPESAFE_API_KEY' })
    await expect(
      SecretReferenceResolver.resolveWithLabel({
        referenceText: '',
        values: undefined,
        environmentValue: '',
        environmentVariableName: 'TYPESAFE_API_KEY',
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses a binding that is not a reference, and a reference with no catalog to resolve it', async () => {
    await expect(SecretReferenceResolver.resolve({ referenceText: 'API_KEY', values: resolving('unused'), environmentValue: 'env-key' })).rejects.toThrow(
      'is not a secret:ALIAS or secret:ALIAS@env reference',
    )
    await expect(SecretReferenceResolver.resolve({ referenceText: 'secret:API_KEY', values: undefined, environmentValue: 'env-key' })).rejects.toThrow(
      'Secret Catalog plugin is not loaded',
    )
  })
})
