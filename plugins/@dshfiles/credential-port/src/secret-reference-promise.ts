import { Effect, Option } from 'effect'
import type { SecretReference } from './grammar.js'
import { resolveSecretCredential, secretResolutionFailed, type ResolvedSecretCredential } from './resolve.js'
import type { SecretCatalogValues } from './secret-reference.js'

const promiseReveal = (values: Pick<SecretCatalogValues, 'resolve'> | undefined, signal: AbortSignal | undefined) =>
  values === undefined
    ? undefined
    : (reference: SecretReference) =>
        Effect.tryPromise({
          try: () => values.resolve(signal === undefined ? { reference, cwd: null } : { reference, cwd: null, signal }),
          catch: secretResolutionFailed(reference),
        })

/**
 * The Promise form of the credential resolver for Host code that is not Effect yet; it runs the same Effect resolution
 * and rejects with the same tagged errors the `SecretReferenceResolver` service fails with.
 */
export class SecretReferenceResolver {
  static async resolve(input: {
    readonly referenceText: string
    readonly values: Pick<SecretCatalogValues, 'resolve'> | undefined
    readonly environmentValue: string | undefined
    readonly signal?: AbortSignal
  }): Promise<string | undefined> {
    return (await SecretReferenceResolver.resolveWithLabel({ ...input, environmentVariableName: 'environment' }))?.value
  }

  static async resolveWithLabel(input: {
    readonly referenceText: string
    readonly values: Pick<SecretCatalogValues, 'resolve'> | undefined
    readonly environmentValue: string | undefined
    readonly environmentVariableName: string
    readonly signal?: AbortSignal
  }): Promise<ResolvedSecretCredential | undefined> {
    const resolved = await Effect.runPromise(
      resolveSecretCredential({
        referenceText: input.referenceText,
        environmentValue: input.environmentValue,
        environmentVariableName: input.environmentVariableName,
        reveal: promiseReveal(input.values, input.signal),
      }),
    )
    return Option.getOrUndefined(resolved)
  }
}
