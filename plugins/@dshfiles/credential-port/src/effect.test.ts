import { it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { describe, expect } from 'vitest'
import { parseSecretReference } from './secret-reference.js'
import {
  SecretReferenceResolver as SecretReferenceResolverService,
  secretAliasSchemaEffect,
  secretCredentialLabelSchemaEffect,
  secretCredentialLabelTextSchemaEffect,
  secretEnvironmentSchemaEffect,
  secretReferenceTextSchemaEffect,
  secretScopeSchemaEffect,
} from './effect.js'

describe('credential port Effect schemas', () => {
  const decodeAlias = Schema.decodeUnknownSync(secretAliasSchemaEffect)
  const decodeEnvironment = Schema.decodeUnknownSync(secretEnvironmentSchemaEffect)
  const decodeReferenceText = Schema.decodeUnknownSync(secretReferenceTextSchemaEffect)
  const decodeCredentialLabel = Schema.decodeUnknownSync(secretCredentialLabelTextSchemaEffect)
  const decodeCanonicalCredentialLabel = Schema.decodeUnknownSync(secretCredentialLabelSchemaEffect)
  const decodeScope = Schema.decodeUnknownSync(secretScopeSchemaEffect)

  it('validates the same reference grammar as the Promise parser', () => {
    for (const text of ['secret:API_KEY', ' secret:API_KEY@dev ', 'secret:A-B_1@prod-eu']) {
      expect(decodeReferenceText(text)).toBe(text)
      expect(parseSecretReference(text)).not.toBeNull()
    }

    for (const text of ['', 'API_KEY', 'secret:', 'secret:1BAD', 'secret:A B', 'secret:A@', 'secret:A@b@c']) {
      expect(() => decodeReferenceText(text)).toThrow()
      expect(parseSecretReference(text)).toBeNull()
    }

    expect(decodeAlias('A')).toBe('A')
    expect(() => decodeAlias('1BAD')).toThrow()
    expect(decodeEnvironment('dev-1')).toBe('dev-1')
    expect(() => decodeEnvironment('bad env')).toThrow()
    expect(decodeScope('project')).toBe('project')
    expect(() => decodeScope('workspace')).toThrow()
    expect(decodeCredentialLabel('env:API_KEY')).toBe('env:API_KEY')
    expect(decodeCredentialLabel(' secret:API_KEY ')).toBe(' secret:API_KEY ')
    expect(decodeCanonicalCredentialLabel(' secret:API_KEY@prod ')).toBe('secret:API_KEY')
    expect(decodeCanonicalCredentialLabel('env:API_KEY')).toBe('env:API_KEY')
    expect(() => decodeCredentialLabel('env:1BAD')).toThrow()
  })
})

describe('SecretReferenceResolverService', () => {
  it.effect('resolves a reference and preserves the environment fallback', () =>
    Effect.gen(function* () {
      const resolver = yield* SecretReferenceResolverService
      const resolved = yield* resolver.resolveWithLabel({
        referenceText: 'secret:API_KEY@dev',
        environmentValue: 'unused-env-value',
        environmentVariableName: 'API_KEY',
      })
      const fallback = yield* resolver.resolve({ referenceText: '', environmentValue: 'environment-value' })

      expect(resolved).toEqual({ value: 'catalog-value', label: 'secret:API_KEY@dev' })
      expect(fallback).toBe('environment-value')
    }).pipe(
      Effect.provide(
        SecretReferenceResolverService.layer({
          resolve: async input => {
            expect(input).toEqual({ reference: { alias: 'API_KEY', environment: 'dev' }, cwd: null })
            return 'catalog-value'
          },
        }),
      ),
    ),
  )

  it.effect('reports invalid, unavailable, and failed catalog resolutions with TaggedErrors', () =>
    Effect.gen(function* () {
      const resolver = yield* SecretReferenceResolverService
      const invalid = yield* Effect.result(resolver.resolve({ referenceText: 'API_KEY', environmentValue: 'fallback' }))
      const unavailable = yield* Effect.result(resolver.resolve({ referenceText: 'secret:API_KEY', environmentValue: 'fallback' }))

      expect(Result.isFailure(invalid) ? invalid.failure._tag : null).toBe('InvalidSecretReferenceError')
      expect(Result.isFailure(unavailable) ? unavailable.failure._tag : null).toBe('SecretCatalogUnavailableError')
    }).pipe(Effect.provide(SecretReferenceResolverService.layer(undefined))),
  )

  it.effect('maps a catalog rejection to a TaggedError without including its cause', () =>
    Effect.gen(function* () {
      const resolver = yield* SecretReferenceResolverService
      const result = yield* Effect.result(resolver.resolve({ referenceText: 'secret:API_KEY', environmentValue: undefined }))

      expect(Result.isFailure(result) ? result.failure._tag : null).toBe('SecretCatalogResolutionError')
      expect(JSON.stringify(result)).not.toContain('sensitive')
    }).pipe(
      Effect.provide(
        SecretReferenceResolverService.layer({
          resolve: async () => Promise.reject(new Error('sensitive provider detail')),
        }),
      ),
    ),
  )
})
