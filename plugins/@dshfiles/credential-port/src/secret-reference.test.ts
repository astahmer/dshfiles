import { describe, expect, it } from 'vitest'
import { formatSecretReference, parseSecretReference, secretReferenceSchema } from './secret-reference.js'

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
