import type { SecretScope } from './index.js'
import type { SecretReference } from './grammar.js'

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
