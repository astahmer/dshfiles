import { it } from '@effect/vitest'
import { Duration, Effect, Exit, Fiber, Result, Schema } from 'effect'
import { TestClock } from 'effect/testing'
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
      expect(() => decodeReferenceText(text)).toThrow('Expected a string matching the RegExp ^\\s*secret:[A-Za-z_][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?\\s*$')
      expect(parseSecretReference(text)).toBeNull()
    }

    expect(decodeAlias('A')).toBe('A')
    expect(() => decodeAlias('1BAD')).toThrow('Expected a string matching the RegExp ^[A-Za-z_][A-Za-z0-9_-]*$')
    expect(decodeEnvironment('dev-1')).toBe('dev-1')
    expect(() => decodeEnvironment('bad env')).toThrow('Expected a string matching the RegExp ^[A-Za-z0-9_-]+$')
    expect(decodeScope('project')).toBe('project')
    expect(() => decodeScope('workspace')).toThrow('Expected "global" | "project" | "local"')
    expect(decodeCredentialLabel('env:API_KEY')).toBe('env:API_KEY')
    expect(decodeCredentialLabel(' secret:API_KEY ')).toBe(' secret:API_KEY ')
    expect(decodeCanonicalCredentialLabel(' secret:API_KEY@prod ')).toBe('secret:API_KEY')
    expect(decodeCanonicalCredentialLabel('env:API_KEY')).toBe('env:API_KEY')
    expect(() => decodeCredentialLabel('env:1BAD')).toThrow(
      'Expected a string matching the RegExp ^(?:\\s*secret:[A-Za-z_][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?\\s*|env:[A-Za-z_][A-Za-z0-9_-]{0,127})$',
    )
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
            expect(input).toMatchObject({ reference: { alias: 'API_KEY', environment: 'dev' }, cwd: null })
            expect(input.signal).toBeInstanceOf(AbortSignal)
            return 'catalog-value'
          },
        }),
      ),
    ),
  )

  it.effect('interrupts catalog resolution when its request is cancelled', () => {
    let resolutionSignal: AbortSignal | undefined

    return Effect.gen(function* () {
      const resolver = yield* SecretReferenceResolverService
      const fiber = yield* Effect.forkScoped(
        Effect.timeout(resolver.resolve({ referenceText: 'secret:API_KEY', environmentValue: undefined }), Duration.millis(20)),
      )
      yield* TestClock.adjust(Duration.millis(20))
      const exit = yield* Fiber.await(fiber)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(resolutionSignal?.aborted).toBe(true)
    }).pipe(
      Effect.provide(
        SecretReferenceResolverService.layer({
          resolve: input => {
            const signal = input.signal
            resolutionSignal = signal
            if (signal === undefined) return Promise.reject(new Error('The resolver omitted its cancellation signal.'))
            return new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
          },
        }),
      ),
    )
  })

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
