import { HostContext } from '@dshfiles/dshx/effect/host-context'
import { Context, Effect, Layer, Option, Schema, SchemaGetter } from 'effect'
import { formatSecretReference, parseSecretReference, type SecretReference } from './grammar.js'
import { resolveSecretCredential, secretResolutionFailed, type ResolvedSecretCredential, type SecretReferenceResolverError } from './resolve.js'
import type { SecretCatalogValues } from './secret-reference.js'

export {
  InvalidSecretReferenceError,
  SecretCatalogResolutionError,
  SecretCatalogUnavailableError,
  type ResolvedSecretCredential,
  type SecretReferenceResolverError,
} from './resolve.js'

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

export interface SecretCredentialRequest {
  readonly referenceText: string
  readonly environmentValue: string | undefined
}

export interface LabelledSecretCredentialRequest extends SecretCredentialRequest {
  readonly environmentVariableName: string
}

const catalogReveal = (values: Pick<SecretCatalogValues, 'resolve'>) => (reference: SecretReference) =>
  Effect.tryPromise({ try: signal => values.resolve({ reference, cwd: null, signal }), catch: secretResolutionFailed(reference) })

/**
 * The one credential resolver: the bound reference through the Secret Catalog when the setting holds one, otherwise
 * the environment variable. Interruption aborts the catalog request.
 */
export class SecretReferenceResolver extends Context.Service<
  SecretReferenceResolver,
  {
    readonly resolve: (input: SecretCredentialRequest) => Effect.Effect<Option.Option<string>, SecretReferenceResolverError>
    readonly resolveWithLabel: (input: LabelledSecretCredentialRequest) => Effect.Effect<Option.Option<ResolvedSecretCredential>, SecretReferenceResolverError>
  }
>()('@dshfiles/credential-port/SecretReferenceResolver') {
  /** Reads the Host's `secretCatalogValues` per call, so the Secret Catalog may load after the plugin using it. */
  static readonly layer = Layer.effect(
    SecretReferenceResolver,
    Effect.map(HostContext, host => makeResolver(() => host.ctx.get('secretCatalogValues'))),
  )

  /** A resolver over an explicit value port (or none), standing in for the Secret Catalog plugin in tests. */
  static readonly layerTest = (values: Pick<SecretCatalogValues, 'resolve'> | undefined) =>
    Layer.succeed(
      SecretReferenceResolver,
      makeResolver(() => values),
    )
}

const makeResolver = (catalog: () => Pick<SecretCatalogValues, 'resolve'> | undefined) => {
  const resolveWithLabel = (input: LabelledSecretCredentialRequest) =>
    Effect.suspend(() => {
      const values = catalog()
      return resolveSecretCredential({ ...input, reveal: values === undefined ? undefined : catalogReveal(values) })
    })
  return SecretReferenceResolver.of({
    resolveWithLabel,
    resolve: input =>
      Effect.map(
        resolveWithLabel({ ...input, environmentVariableName: 'environment' }),
        Option.map(credential => credential.value),
      ),
  })
}

export { SecretReferenceResolver as SecretReferenceResolverService }
