import { Context, Effect, Layer, Schema, SchemaGetter } from 'effect'
import {
  formatSecretReference,
  parseSecretReference,
  SecretReferenceResolver as PromiseSecretReferenceResolver,
  type ResolvedSecretCredential,
  type SecretCatalogValues,
} from './secret-reference.js'

export const secretAliasSchemaEffect = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128), Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]*$/u))

export const secretEnvironmentSchemaEffect = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256), Schema.isPattern(/^[A-Za-z0-9_-]+$/u))

export const secretScopeSchemaEffect = Schema.Literals(['global', 'project', 'local'])

/** Validates the raw reference text; use parseSecretReference to obtain its parsed alias and environment. */
export const secretReferenceTextSchemaEffect = Schema.String.check(
  Schema.isMaxLength(4096),
  Schema.isPattern(/^\s*secret:[A-Za-z_][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?\s*$/u),
)

/** Validates a secret reference label or an `env:VARIABLE_NAME` label without changing its text. */
export const secretCredentialLabelTextSchemaEffect = Schema.String.check(
  Schema.isMaxLength(400),
  Schema.isPattern(/^(?:\s*secret:[A-Za-z_][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?\s*|env:[A-Za-z_][A-Za-z0-9_-]{0,127})$/u),
)

const canonicalCredentialLabel = (text: string): string => {
  const reference = parseSecretReference(text)
  return reference === null ? text : formatSecretReference(reference)
}

export const secretCredentialLabelSchemaEffect = secretCredentialLabelTextSchemaEffect.pipe(
  Schema.decode({
    decode: SchemaGetter.transform(canonicalCredentialLabel),
    encode: SchemaGetter.transform(canonicalCredentialLabel),
  }),
)

export class InvalidSecretReferenceError extends Schema.TaggedError<InvalidSecretReferenceError>()('InvalidSecretReferenceError', {}) {}

export class SecretCatalogUnavailableError extends Schema.TaggedError<SecretCatalogUnavailableError>()('SecretCatalogUnavailableError', {}) {}

export class SecretCatalogResolutionError extends Schema.TaggedError<SecretCatalogResolutionError>()('SecretCatalogResolutionError', {}) {}

export type SecretReferenceResolverError = InvalidSecretReferenceError | SecretCatalogUnavailableError | SecretCatalogResolutionError

export class SecretReferenceResolverService extends Context.Service<
  SecretReferenceResolverService,
  {
    resolve(input: {
      readonly referenceText: string
      readonly environmentValue: string | undefined
    }): Effect.Effect<string | undefined, SecretReferenceResolverError>
    resolveWithLabel(input: {
      readonly referenceText: string
      readonly environmentValue: string | undefined
      readonly environmentVariableName: string
    }): Effect.Effect<ResolvedSecretCredential | undefined, SecretReferenceResolverError>
  }
>()('@dshfiles/credential-port/SecretReferenceResolver') {
  static layer(values: Pick<SecretCatalogValues, 'resolve'> | undefined) {
    const resolveWithLabel = (input: {
      readonly referenceText: string
      readonly environmentValue: string | undefined
      readonly environmentVariableName: string
    }): Effect.Effect<ResolvedSecretCredential | undefined, SecretReferenceResolverError> => {
      const reference = parseSecretReference(input.referenceText)
      if (reference === null && input.referenceText.trim() !== '') return Effect.fail(new InvalidSecretReferenceError())
      if (reference !== null && values === undefined) return Effect.fail(new SecretCatalogUnavailableError())
      return Effect.tryPromise({
        try: signal => PromiseSecretReferenceResolver.resolveWithLabel({ ...input, values, signal }),
        catch: () => new SecretCatalogResolutionError(),
      })
    }

    return Layer.succeed(
      SecretReferenceResolverService,
      SecretReferenceResolverService.of({
        resolve: input => Effect.map(resolveWithLabel({ ...input, environmentVariableName: 'environment' }), credential => credential?.value),
        resolveWithLabel,
      }),
    )
  }
}

export { SecretReferenceResolverService as SecretReferenceResolver }
