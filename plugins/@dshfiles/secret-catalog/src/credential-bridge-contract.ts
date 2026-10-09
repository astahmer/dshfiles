import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

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
  }): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    secretCatalogCredentials?: SecretCatalogCredentialBridge
  }
}
