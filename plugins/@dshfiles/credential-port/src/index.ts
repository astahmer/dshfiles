import type {} from '@deepseek-ai/cordis'
import { z } from 'zod'

export {
  DEFAULT_SECRET_ENVIRONMENT,
  formatSecretReference,
  parseSecretReference,
  secretAliasSchema,
  secretEnvironmentSchema,
  secretReferenceSchema,
  secretCredentialLabelSchema,
  SecretReferenceResolver,
  type SecretCatalogValues,
  type SecretReference,
  type SecretReferenceResolution,
  type ResolvedSecretCredential,
} from './secret-reference.js'

/**
 * The port a secrets catalog provides on the Cordis Context and credential consumers call. It lives in its own package
 * because both sides import it: whichever plugin owned it would make the other depend on that plugin's whole dependency
 * chain, and one such edge closed a task-graph cycle that pnpm and Turbo refuse to build.
 */

export const secretScopeSchema = z.enum(['global', 'project', 'local'])
export type SecretScope = z.infer<typeof secretScopeSchema>

export interface SecretCatalogKeyOption {
  readonly alias: string
  readonly environment: string
  readonly scope: SecretScope
  readonly cwd: string | null
  readonly variableName: string
  readonly service: string
  readonly description: string
}

export interface SecretCatalogCredentialBridge {
  listKeys(cwd: string | null): Promise<readonly SecretCatalogKeyOption[]>
  importKey(input: {
    readonly alias: string
    readonly environment: string
    readonly scope: SecretScope
    readonly cwd: string | null
    readonly targetRef: string
    readonly replaceExisting?: boolean | undefined
  }): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    secretCatalogCredentials?: SecretCatalogCredentialBridge
  }
}
