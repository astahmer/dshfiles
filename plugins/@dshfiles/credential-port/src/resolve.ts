import { Effect, Option, Schema } from 'effect'
import { formatSecretReference, parseSecretReference, type SecretReference } from './grammar.js'

export interface ResolvedSecretCredential {
  readonly value: string
  readonly label: string
}

/** The bound text is neither empty nor a reference. The text itself is not kept: it may be a pasted key. */
export class InvalidSecretReferenceError extends Schema.TaggedError<InvalidSecretReferenceError>()('InvalidSecretReferenceError', {}) {
  override get message(): string {
    return 'The bound key is not a secret:ALIAS or secret:ALIAS@env reference. Pick a key from the Secret Catalog or clear the field.'
  }
}

export class SecretCatalogUnavailableError extends Schema.TaggedError<SecretCatalogUnavailableError>()('SecretCatalogUnavailableError', {}) {
  override get message(): string {
    return 'The Secret Catalog plugin is not loaded, so the bound secret reference cannot be resolved. Enable it in Settings, or clear the reference to use the environment variable.'
  }
}

/** The Secret Catalog refused or failed to reveal the referenced value. */
export class SecretCatalogResolutionError extends Schema.TaggedError<SecretCatalogResolutionError>()('SecretCatalogResolutionError', {
  alias: Schema.String,
  environment: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The Secret Catalog could not resolve ${formatSecretReference(this)}. Check the alias in the Secret Catalog, then retry.`
  }
}

export type SecretReferenceResolverError = InvalidSecretReferenceError | SecretCatalogUnavailableError | SecretCatalogResolutionError

export interface ResolveSecretCredentialInput {
  readonly referenceText: string
  readonly environmentValue: string | undefined
  readonly environmentVariableName: string
  /** Reveal one reference through the Secret Catalog; undefined when the catalog is not loaded. */
  readonly reveal: ((reference: SecretReference) => Effect.Effect<string, SecretCatalogResolutionError>) | undefined
}

/**
 * The key a Host feature uses for an API: the bound reference when the setting holds one, otherwise the process
 * environment variable it has always read.
 */
export const resolveSecretCredential = Effect.fn('secret resolve')(function* (input: ResolveSecretCredentialInput) {
  const reference = parseSecretReference(input.referenceText)
  if (reference !== null) {
    if (input.reveal === undefined) return yield* new SecretCatalogUnavailableError()
    const value = yield* input.reveal(reference)
    return Option.some<ResolvedSecretCredential>({ value, label: formatSecretReference(reference) })
  }
  if (input.referenceText.trim() !== '') return yield* new InvalidSecretReferenceError()
  if (input.environmentValue === undefined || input.environmentValue === '') return Option.none<ResolvedSecretCredential>()
  return Option.some<ResolvedSecretCredential>({ value: input.environmentValue, label: `env:${input.environmentVariableName}` })
})

/** The failure of revealing `reference`, keeping the catalog's error as its cause. */
export const secretResolutionFailed = (reference: SecretReference) => (cause: unknown) =>
  new SecretCatalogResolutionError({ alias: reference.alias, environment: reference.environment, cause })
