import { Effect, Option } from 'effect'
import type { SecretScope } from './index.js'
import type { SecretReference } from './grammar.js'
import { resolveSecretCredential, secretResolutionFailed, type ResolvedSecretCredential } from './resolve.js'

export { DEFAULT_SECRET_ENVIRONMENT, formatSecretReference, parseSecretReference, type SecretReference } from './grammar.js'
export type { ResolvedSecretCredential } from './resolve.js'

/** One reference resolved for a folder: `project`/`local` aliases come from that folder's config, `global` needs none. */
export interface SecretReferenceResolution {
  readonly reference: SecretReference
  readonly cwd: string | null
  /** Bind a metadata selection to this exact scope; owners advertising supportsExpectedScope enforce it before reveal. */
  readonly expectedScope?: SecretScope
  readonly signal?: AbortSignal
}

/**
 * The Host-side value port: a consumer resolves a stored reference at the moment it uses the credential. The value
 * never travels to a Client, which is why this is separate from the browser-facing Secret Catalog API.
 */
export interface SecretCatalogValues {
  /** Capability fence: older owners may accept extra fields without enforcing them. */
  readonly supportsExpectedScope?: true
  resolve(input: SecretReferenceResolution): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    secretCatalogValues?: SecretCatalogValues
  }
}

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
