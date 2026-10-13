import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { isKeyEnvName } from './api.js'

export type CredentialValueResolver = (name: string) => Promise<string>

/** Read an API-key reference from the process environment for legacy callers without DSH credentials. */
export const readKeyFromEnv = (name: string): string => {
  const trimmed = name.trim()
  return isKeyEnvName(trimmed) ? (process.env[trimmed] ?? '').trim() : ''
}

export const resolveKeyFromProvider = async (credentials: Pick<CredentialProvider, 'resolve'> | undefined, name: string): Promise<string> => {
  const trimmed = name.trim()
  if (!isKeyEnvName(trimmed)) return ''
  if (credentials === undefined) return readKeyFromEnv(trimmed)
  return (await credentials.resolve(credentialRef(trimmed)))?.value.trim() ?? ''
}

/** Resolve a key per operation; provider-managed changes need no plugin restart. */
export const resolveKeyFromContext =
  (ctx: Context): CredentialValueResolver =>
  name =>
    resolveKeyFromProvider(ctx.get('credentials'), name)

interface DiscoveryRequest {
  readonly baseURL?: string
  readonly apiKey?: string
}

interface StoredKeyedRoute {
  readonly apiBaseUrl: string
  readonly keyEnv: string
}

/** A draft's own key may probe the draft's endpoint; the stored key only ever goes to the stored base. */
export const discoveryCatalogOptions = (request: DiscoveryRequest, stored: StoredKeyedRoute, resolvedKey?: string) => {
  const draftKey = request.apiKey?.trim() ?? ''
  return draftKey.length > 0
    ? { baseUrl: request.baseURL ?? stored.apiBaseUrl, apiKey: draftKey }
    : { baseUrl: stored.apiBaseUrl, apiKey: resolvedKey ?? readKeyFromEnv(stored.keyEnv) }
}
