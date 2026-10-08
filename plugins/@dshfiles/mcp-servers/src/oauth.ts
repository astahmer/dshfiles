import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'

/** OAuth 2.1 client flow for remote MCP servers: discovery, dynamic registration, PKCE, and refresh. */

type Fetch = (input: URL, init?: RequestInit) => Promise<Response>

const REQUEST_TIMEOUT_MS = 10_000
const REFRESH_MARGIN_MS = 60_000

export const oauthGrantSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  tokenEndpoint: z.string().url(),
  resource: z.string().url(),
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  issuedAt: z.number(),
})

export type OAuthGrant = z.infer<typeof oauthGrantSchema>

export interface OAuthEndpoints {
  readonly resource: string
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly registrationEndpoint: string | undefined
  readonly scopes: readonly string[]
}

export interface PendingAuthorization {
  readonly serverId: string
  readonly verifier: string
  readonly redirectUri: string
  readonly clientId: string
  readonly clientSecret: string | undefined
  readonly tokenEndpoint: string
  readonly resource: string
  readonly createdAt: number
}

const protectedResourceSchema = z.object({
  resource: z.string().url().optional(),
  authorization_servers: z.array(z.string().url()).optional(),
  scopes_supported: z.array(z.string()).optional(),
})

const authorizationServerSchema = z.object({
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  registration_endpoint: z.string().url().optional(),
  scopes_supported: z.array(z.string()).optional(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
})

const registrationSchema = z.object({ client_id: z.string().min(1), client_secret: z.string().optional() })

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
})

const isLoopback = (hostname: string): boolean => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

/** Endpoints must be HTTPS; plain HTTP is accepted only for loopback development servers. */
const trustedEndpoint = (value: string): string => {
  const url = new URL(value)
  if (url.username !== '' || url.password !== '') throw new Error('OAuth endpoints must not embed credentials.')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) throw new Error('OAuth endpoints must use HTTPS.')
  return url.href
}

const fetchJson = async (fetcher: Fetch, url: URL, init?: RequestInit): Promise<unknown | undefined> => {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { accept: 'application/json', ...init?.headers } })
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`OAuth request to ${url.host} failed with HTTP ${response.status}.`)
  return response.json()
}

const wellKnownCandidates = (base: URL, suffix: string): URL[] => {
  const path = base.pathname.replace(/\/+$/, '')
  const candidates = path.length > 0 && path !== '/' ? [new URL(`/.well-known/${suffix}${path}`, base.origin)] : []
  return [...candidates, new URL(`/.well-known/${suffix}`, base.origin)]
}

const firstMetadata = async <T>(fetcher: Fetch, urls: readonly URL[], schema: z.ZodType<T>): Promise<T | undefined> => {
  for (const url of urls) {
    const body = await fetchJson(fetcher, url).catch(() => undefined)
    if (body === undefined) continue
    const parsed = schema.safeParse(body)
    if (parsed.success) return parsed.data
  }
  return undefined
}

/** RFC 9728 protected-resource metadata, then RFC 8414 (or OpenID) authorization-server metadata. */
export const discoverOAuth = async (serverUrl: string, fetcher: Fetch = fetch): Promise<OAuthEndpoints> => {
  const server = new URL(serverUrl)
  const resourceMetadata = await firstMetadata(fetcher, wellKnownCandidates(server, 'oauth-protected-resource'), protectedResourceSchema)
  const issuer = new URL(resourceMetadata?.authorization_servers?.[0] ?? server.origin)
  const metadata =
    (await firstMetadata(fetcher, wellKnownCandidates(issuer, 'oauth-authorization-server'), authorizationServerSchema)) ??
    (await firstMetadata(fetcher, wellKnownCandidates(issuer, 'openid-configuration'), authorizationServerSchema))
  if (metadata === undefined) throw new Error('This MCP server does not publish OAuth authorization metadata.')
  const methods = metadata.code_challenge_methods_supported
  if (methods !== undefined && !methods.includes('S256')) throw new Error('The authorization server does not support PKCE S256.')
  return {
    resource: resourceMetadata?.resource ?? server.href,
    authorizationEndpoint: trustedEndpoint(metadata.authorization_endpoint),
    tokenEndpoint: trustedEndpoint(metadata.token_endpoint),
    registrationEndpoint: metadata.registration_endpoint === undefined ? undefined : trustedEndpoint(metadata.registration_endpoint),
    scopes: resourceMetadata?.scopes_supported ?? metadata.scopes_supported ?? [],
  }
}

/** RFC 7591 dynamic client registration as a public client. */
export const registerClient = async (
  input: { readonly registrationEndpoint: string; readonly redirectUri: string; readonly clientName: string },
  fetcher: Fetch = fetch,
): Promise<{ readonly clientId: string; readonly clientSecret: string | undefined }> => {
  const body = await fetchJson(fetcher, new URL(input.registrationEndpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: input.clientName,
      redirect_uris: [input.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  const parsed = registrationSchema.parse(body)
  return { clientId: parsed.client_id, clientSecret: parsed.client_secret }
}

const base64Url = (bytes: Buffer): string => bytes.toString('base64url')

export const createPkcePair = (): { readonly verifier: string; readonly challenge: string } => {
  const verifier = base64Url(randomBytes(32))
  return { verifier, challenge: base64Url(createHash('sha256').update(verifier).digest()) }
}

export const createState = (): string => base64Url(randomBytes(24))

export const authorizationUrl = (input: {
  readonly endpoints: OAuthEndpoints
  readonly clientId: string
  readonly redirectUri: string
  readonly challenge: string
  readonly state: string
}): string => {
  const url = new URL(input.endpoints.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', input.state)
  url.searchParams.set('resource', input.endpoints.resource)
  if (input.endpoints.scopes.length > 0) url.searchParams.set('scope', input.endpoints.scopes.join(' '))
  return url.href
}

const requestToken = async (
  input: { readonly tokenEndpoint: string; readonly clientId: string; readonly clientSecret: string | undefined; readonly params: Record<string, string> },
  fetcher: Fetch,
): Promise<z.infer<typeof tokenSchema>> => {
  const form = new URLSearchParams({ ...input.params, client_id: input.clientId })
  if (input.clientSecret !== undefined) form.set('client_secret', input.clientSecret)
  const body = await fetchJson(fetcher, new URL(input.tokenEndpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  return tokenSchema.parse(body)
}

const grantFromToken = (
  token: z.infer<typeof tokenSchema>,
  client: Pick<OAuthGrant, 'clientId' | 'clientSecret' | 'tokenEndpoint' | 'resource'>,
  now: number,
  previousRefreshToken?: string,
): OAuthGrant => {
  const refreshToken = token.refresh_token ?? previousRefreshToken
  return {
    clientId: client.clientId,
    ...(client.clientSecret === undefined ? {} : { clientSecret: client.clientSecret }),
    tokenEndpoint: client.tokenEndpoint,
    resource: client.resource,
    accessToken: token.access_token,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(token.expires_in === undefined ? {} : { expiresAt: now + token.expires_in * 1000 }),
    issuedAt: now,
  }
}

export const exchangeCode = async (pending: PendingAuthorization, code: string, fetcher: Fetch = fetch, now = Date.now()): Promise<OAuthGrant> => {
  const token = await requestToken(
    {
      tokenEndpoint: pending.tokenEndpoint,
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      params: { grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier, resource: pending.resource },
    },
    fetcher,
  )
  return grantFromToken(token, pending, now)
}

export const needsRefresh = (grant: OAuthGrant, now = Date.now()): boolean => grant.expiresAt !== undefined && grant.expiresAt - now < REFRESH_MARGIN_MS

/** Refreshes an expiring grant; `undefined` means the user must sign in again. */
export const refreshGrant = async (grant: OAuthGrant, fetcher: Fetch = fetch, now = Date.now()): Promise<OAuthGrant | undefined> => {
  if (grant.refreshToken === undefined) return undefined
  try {
    const token = await requestToken(
      {
        tokenEndpoint: grant.tokenEndpoint,
        clientId: grant.clientId,
        clientSecret: grant.clientSecret,
        params: { grant_type: 'refresh_token', refresh_token: grant.refreshToken, resource: grant.resource },
      },
      fetcher,
    )
    return grantFromToken(token, grant, now, grant.refreshToken)
  } catch {
    return undefined
  }
}

/** Origin the browser reached DSH through; the OAuth redirect returns there. */
export const callbackRedirectUri = (origin: string, callbackPath: string): string => {
  const url = new URL(origin)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The DSH origin must be HTTP or HTTPS.')
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') throw new Error('Pass only the DSH origin.')
  return new URL(callbackPath, url.origin).href
}
