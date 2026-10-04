import { isKeyEnvName } from './api.js'

/** Read a keyed account's credential, refusing any variable not named as an API key. */
export const readKeyFromEnv = (name: string): string => {
  const trimmed = name.trim()
  return isKeyEnvName(trimmed) ? (process.env[trimmed] ?? '').trim() : ''
}

interface DiscoveryRequest {
  readonly baseURL?: string
  readonly apiKey?: string
}

interface StoredKeyedRoute {
  readonly apiBaseUrl: string
  readonly keyEnv: string
}

/** A draft's own key may probe the draft's endpoint; the stored key only ever goes to the stored base. */
export const discoveryCatalogOptions = (request: DiscoveryRequest, stored: StoredKeyedRoute) => {
  const draftKey = request.apiKey?.trim() ?? ''
  return draftKey.length > 0
    ? { baseUrl: request.baseURL ?? stored.apiBaseUrl, apiKey: draftKey }
    : { baseUrl: stored.apiBaseUrl, apiKey: readKeyFromEnv(stored.keyEnv) }
}
