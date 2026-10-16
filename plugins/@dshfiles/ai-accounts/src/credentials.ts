import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { AccountsRules } from './api.js'

export type CredentialValueResolver = (name: string) => Promise<string>

interface DiscoveryRequest {
  readonly baseURL?: string
  readonly apiKey?: string
}

interface StoredKeyedRoute {
  readonly apiBaseUrl: string
  readonly keyEnv: string
}

export class CredentialModel {
  static readonly readKeyFromEnv = (name: string): string => {
    const trimmed = name.trim()
    return AccountsRules.isKeyEnvName(trimmed) ? (process.env[trimmed] ?? '').trim() : ''
  }

  static readonly discoveryCatalogOptions = (request: DiscoveryRequest, stored: StoredKeyedRoute, resolvedKey?: string) => {
    const draftKey = request.apiKey?.trim() ?? ''
    return draftKey.length > 0
      ? { baseUrl: request.baseURL ?? stored.apiBaseUrl, apiKey: draftKey }
      : { baseUrl: stored.apiBaseUrl, apiKey: resolvedKey ?? CredentialModel.readKeyFromEnv(stored.keyEnv) }
  }
}

export const createCredentialResolver =
  (credentials: Pick<CredentialProvider, 'resolve'> | undefined): CredentialValueResolver =>
  async name => {
    const trimmed = name.trim()
    if (!AccountsRules.isKeyEnvName(trimmed)) return ''
    if (credentials === undefined) return CredentialModel.readKeyFromEnv(trimmed)
    return (await credentials.resolve(credentialRef(trimmed)))?.value.trim() ?? ''
  }

/** Resolve a key per operation; provider-managed changes need no plugin restart. */
export const resolveKeyFromContext = (ctx: Context): CredentialValueResolver => createCredentialResolver(ctx.get('credentials'))
