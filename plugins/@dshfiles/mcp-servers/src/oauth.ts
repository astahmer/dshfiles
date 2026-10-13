import * as oauth from 'oauth4webapi'
import { z } from 'zod'

/** OAuth 2.1 client flow for remote MCP servers: discovery, dynamic registration, PKCE, and refresh. */

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const REQUEST_TIMEOUT_MS = 10_000
const REFRESH_MARGIN_MS = 60_000

export const oauthGrantSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().optional(),
  issuer: z.string().url().optional(),
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
  readonly authorizationServer: oauth.AuthorizationServer
  readonly scopes: readonly string[]
}

export interface PendingAuthorization {
  readonly serverId: string
  readonly state: string
  readonly verifier: string
  readonly redirectUri: string
  readonly clientId: string
  readonly clientSecret: string | undefined
  readonly authorizationServer: oauth.AuthorizationServer
  readonly resource: string
  readonly createdAt: number
}

const isLoopback = (hostname: string): boolean => hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'

/** Endpoints must be HTTPS; plain HTTP is accepted only for loopback development servers. */
const trustedEndpoint = (value: string | undefined): void => {
  if (value === undefined) return
  const url = new URL(value)
  if (url.username !== '' || url.password !== '') throw new Error('OAuth endpoints must not embed credentials.')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) throw new Error('OAuth endpoints must use HTTPS.')
}

const requestOptions = (fetcher: Fetch, target: string) => {
  const url = new URL(target)
  return {
    [oauth.customFetch]: fetcher,
    signal: () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(url.protocol === 'http:' && isLoopback(url.hostname) ? { [oauth.allowInsecureRequests]: true } : {}),
  }
}

/** RFC 9728 §5.1: an unauthenticated request may answer 401 with a `resource_metadata` hint. */
const resourceMetadataHint = async (fetcher: Fetch, server: URL): Promise<URL | undefined> => {
  const response = await fetcher(server.href, {
    method: 'GET',
    headers: { accept: 'application/json, text/event-stream' },
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined)
  await response?.body?.cancel().catch(() => undefined)
  if (response?.status !== 401) return undefined
  const hint = /resource_metadata="([^"]+)"/i.exec(response.headers.get('www-authenticate') ?? '')?.[1]
  if (hint === undefined || !URL.canParse(hint)) return undefined
  const url = new URL(hint)
  trustedEndpoint(url.href)
  return url
}

const protectedResource = async (fetcher: Fetch, server: URL): Promise<oauth.ResourceServer | undefined> => {
  const options = requestOptions(fetcher, server.href)
  const hint = await resourceMetadataHint(fetcher, server)
  const attempts: (() => Promise<Response>)[] = [
    ...(hint === undefined
      ? []
      : [
          () =>
            fetcher(hint.href, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
        ]),
    () => oauth.resourceDiscoveryRequest(server, options),
    ...(server.pathname === '/' ? [] : [() => oauth.resourceDiscoveryRequest(new URL(server.origin), options)]),
  ]
  for (const attempt of attempts) {
    const response = await attempt().catch(() => undefined)
    if (response === undefined) continue
    for (const expected of [server, new URL(server.origin)]) {
      const metadata = await oauth.processResourceDiscoveryResponse(expected, response.clone()).catch(() => undefined)
      if (metadata !== undefined) return metadata
    }
  }
  return undefined
}

/** RFC 8414 then OpenID discovery; the published `issuer` must match the one asked for (mix-up defence). */
const authorizationServerMetadata = async (fetcher: Fetch, issuer: URL): Promise<oauth.AuthorizationServer | undefined> => {
  for (const algorithm of ['oauth2', 'oidc'] as const) {
    const metadata = await oauth
      .discoveryRequest(issuer, { ...requestOptions(fetcher, issuer.href), algorithm })
      .then(response => oauth.processDiscoveryResponse(issuer, response))
      .catch(() => undefined)
    if (metadata !== undefined) return metadata
  }
  return undefined
}

/** RFC 9728 protected-resource metadata, then RFC 8414 (or OpenID) authorization-server metadata. */
export const discoverOAuth = async (serverUrl: string, fetcher: Fetch = fetch): Promise<OAuthEndpoints> => {
  const server = new URL(serverUrl)
  const resourceMetadata = await protectedResource(fetcher, server)
  const issuer = new URL(resourceMetadata?.authorization_servers?.[0] ?? server.origin)
  trustedEndpoint(issuer.href)
  const metadata = await authorizationServerMetadata(fetcher, issuer)
  if (metadata?.authorization_endpoint === undefined || metadata.token_endpoint === undefined) {
    throw new Error('This MCP server does not publish OAuth authorization metadata.')
  }
  const methods = metadata.code_challenge_methods_supported
  if (methods !== undefined && !methods.includes('S256')) throw new Error('The authorization server does not support PKCE S256.')
  trustedEndpoint(metadata.authorization_endpoint)
  trustedEndpoint(metadata.token_endpoint)
  trustedEndpoint(metadata.registration_endpoint)
  return {
    resource: resourceMetadata?.resource ?? server.href,
    authorizationServer: metadata,
    scopes: resourceMetadata?.scopes_supported ?? metadata.scopes_supported ?? [],
  }
}

/** RFC 7591 dynamic client registration as a public client. */
export const registerClient = async (
  input: { readonly authorizationServer: oauth.AuthorizationServer; readonly redirectUri: string; readonly clientName: string },
  fetcher: Fetch = fetch,
): Promise<{ readonly clientId: string; readonly clientSecret: string | undefined }> => {
  const endpoint = input.authorizationServer.registration_endpoint
  if (endpoint === undefined) throw new Error('The authorization server does not support dynamic client registration.')
  const response = await oauth.dynamicClientRegistrationRequest(
    input.authorizationServer,
    {
      client_name: input.clientName,
      redirect_uris: [input.redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    requestOptions(fetcher, endpoint),
  )
  const client = await oauth.processDynamicClientRegistrationResponse(response)
  return { clientId: client.client_id, clientSecret: typeof client.client_secret === 'string' ? client.client_secret : undefined }
}

export const createPkcePair = async (): Promise<{ readonly verifier: string; readonly challenge: string }> => {
  const verifier = oauth.generateRandomCodeVerifier()
  return { verifier, challenge: await oauth.calculatePKCECodeChallenge(verifier) }
}

export const createState = (): string => oauth.generateRandomState()

export const authorizationUrl = (input: {
  readonly endpoints: OAuthEndpoints
  readonly clientId: string
  readonly redirectUri: string
  readonly challenge: string
  readonly state: string
}): string => {
  const endpoint = input.endpoints.authorizationServer.authorization_endpoint
  if (endpoint === undefined) throw new Error('The authorization server has no authorization endpoint.')
  const url = new URL(endpoint)
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

const clientAuth = (clientSecret: string | undefined): oauth.ClientAuth => (clientSecret === undefined ? oauth.None() : oauth.ClientSecretPost(clientSecret))

const grantFromToken = (
  token: oauth.TokenEndpointResponse,
  client: Pick<OAuthGrant, 'clientId' | 'clientSecret' | 'issuer' | 'tokenEndpoint' | 'resource'>,
  now: number,
  previousRefreshToken?: string,
): OAuthGrant => {
  const refreshToken = token.refresh_token ?? previousRefreshToken
  return {
    clientId: client.clientId,
    ...(client.clientSecret === undefined ? {} : { clientSecret: client.clientSecret }),
    ...(client.issuer === undefined ? {} : { issuer: client.issuer }),
    tokenEndpoint: client.tokenEndpoint,
    resource: client.resource,
    accessToken: token.access_token,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(token.expires_in === undefined ? {} : { expiresAt: now + token.expires_in * 1000 }),
    issuedAt: now,
  }
}

/** Validates the callback (state, RFC 9207 `iss`) and exchanges its code with the PKCE verifier. */
export const exchangeCode = async (
  pending: PendingAuthorization,
  callbackParameters: URLSearchParams,
  fetcher: Fetch = fetch,
  now = Date.now(),
): Promise<OAuthGrant> => {
  const as = pending.authorizationServer
  const tokenEndpoint = as.token_endpoint
  if (tokenEndpoint === undefined) throw new Error('The authorization server has no token endpoint.')
  const client: oauth.Client = { client_id: pending.clientId }
  const parameters = oauth.validateAuthResponse(as, client, callbackParameters, pending.state)
  const response = await oauth.authorizationCodeGrantRequest(as, client, clientAuth(pending.clientSecret), parameters, pending.redirectUri, pending.verifier, {
    ...requestOptions(fetcher, tokenEndpoint),
    additionalParameters: { resource: pending.resource },
  })
  const token = await oauth.processAuthorizationCodeResponse(as, client, response)
  return grantFromToken(
    token,
    { clientId: pending.clientId, clientSecret: pending.clientSecret, issuer: as.issuer, tokenEndpoint, resource: pending.resource },
    now,
  )
}

export const needsRefresh = (grant: OAuthGrant, now = Date.now()): boolean => grant.expiresAt !== undefined && grant.expiresAt - now < REFRESH_MARGIN_MS

/** Refreshes an expiring grant; `undefined` means the user must sign in again. */
export const refreshGrant = async (grant: OAuthGrant, fetcher: Fetch = fetch, now = Date.now()): Promise<OAuthGrant | undefined> => {
  if (grant.refreshToken === undefined) return undefined
  const as: oauth.AuthorizationServer = { issuer: grant.issuer ?? new URL(grant.tokenEndpoint).origin, token_endpoint: grant.tokenEndpoint }
  const client: oauth.Client = { client_id: grant.clientId }
  try {
    const response = await oauth.refreshTokenGrantRequest(as, client, clientAuth(grant.clientSecret), grant.refreshToken, {
      ...requestOptions(fetcher, grant.tokenEndpoint),
      additionalParameters: { resource: grant.resource },
    })
    return grantFromToken(await oauth.processRefreshTokenResponse(as, client, response), grant, now, grant.refreshToken)
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
