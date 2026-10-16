import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { McpOAuthModel, type OAuthGrant, type PendingAuthorization } from './oauth.js'

type OAuthResponseFixture = Readonly<Record<string, string | number | readonly string[]>>
type OAuthResponseTable = Readonly<Record<string, OAuthResponseFixture>>

const json = (body: OAuthResponseFixture, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const routes = (table: OAuthResponseTable) =>
  vi.fn(async (url: string, _init: RequestInit) => {
    const body = table[url]
    return body === undefined ? new Response('missing', { status: 404 }) : json(body)
  })

const authorizationServer = {
  issuer: 'https://auth.example.test',
  authorization_endpoint: 'https://auth.example.test/authorize',
  token_endpoint: 'https://auth.example.test/token',
  registration_endpoint: 'https://auth.example.test/register',
  code_challenge_methods_supported: ['S256'],
}

describe('MCP OAuth discovery', () => {
  it('follows protected-resource metadata to the authorization server', async () => {
    const fetcher = routes({
      'https://mcp.example.test/.well-known/oauth-protected-resource/mcp': {
        resource: 'https://mcp.example.test/mcp',
        authorization_servers: ['https://auth.example.test'],
        scopes_supported: ['read'],
      },
      'https://auth.example.test/.well-known/oauth-authorization-server': authorizationServer,
    })
    const endpoints = await McpOAuthModel.discover({ serverUrl: 'https://mcp.example.test/mcp', fetcher })
    expect(endpoints.resource).toBe('https://mcp.example.test/mcp')
    expect(endpoints.scopes).toEqual(['read'])
    expect(endpoints.authorizationServer.token_endpoint).toBe('https://auth.example.test/token')
  })

  it('honours the resource_metadata hint from a 401 challenge', async () => {
    const table = routes({
      'https://meta.example.test/prm': { resource: 'https://mcp.example.test/mcp', authorization_servers: ['https://auth.example.test'] },
      'https://auth.example.test/.well-known/oauth-authorization-server': authorizationServer,
    })
    const fetcher = vi.fn(async (url: string, init: RequestInit) =>
      url === 'https://mcp.example.test/mcp'
        ? new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="https://meta.example.test/prm"' } })
        : table(url, init),
    )
    expect((await McpOAuthModel.discover({ serverUrl: 'https://mcp.example.test/mcp', fetcher })).authorizationServer.issuer).toBe('https://auth.example.test')
    expect(fetcher.mock.calls.map(([url]) => url)).not.toContain('https://mcp.example.test/.well-known/oauth-protected-resource/mcp')
  })

  it('appends the OpenID discovery suffix after the issuer path', async () => {
    const issuer = 'https://auth.example.test/tenant'
    const fetcher = routes({
      'https://mcp.example.test/.well-known/oauth-protected-resource': { resource: 'https://mcp.example.test/', authorization_servers: [issuer] },
      'https://auth.example.test/tenant/.well-known/openid-configuration': { ...authorizationServer, issuer },
    })
    expect((await McpOAuthModel.discover({ serverUrl: 'https://mcp.example.test/', fetcher })).authorizationServer.issuer).toBe(issuer)
  })

  it('rejects metadata whose issuer differs from the advertised authorization server', async () => {
    const fetcher = routes({
      'https://mcp.example.test/.well-known/oauth-protected-resource': {
        resource: 'https://mcp.example.test/',
        authorization_servers: ['https://auth.example.test'],
      },
      'https://auth.example.test/.well-known/oauth-authorization-server': { ...authorizationServer, issuer: 'https://evil.example.test' },
    })
    await expect(McpOAuthModel.discover({ serverUrl: 'https://mcp.example.test/', fetcher })).rejects.toThrow('authorization metadata')
  })

  it('falls back to the server origin and rejects plain-HTTP remote endpoints', async () => {
    const fetcher = routes({
      'https://mcp.example.test/.well-known/oauth-authorization-server': {
        issuer: 'https://mcp.example.test',
        authorization_endpoint: 'http://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
      },
    })
    await expect(McpOAuthModel.discover({ serverUrl: 'https://mcp.example.test/mcp', fetcher })).rejects.toThrow('HTTPS')
  })

  it('refuses a server without PKCE S256', async () => {
    const fetcher = routes({
      'https://mcp.example.test/.well-known/oauth-authorization-server': {
        issuer: 'https://mcp.example.test',
        authorization_endpoint: 'https://mcp.example.test/authorize',
        token_endpoint: 'https://mcp.example.test/token',
        code_challenge_methods_supported: ['plain'],
      },
    })
    await expect(McpOAuthModel.discover({ serverUrl: 'https://mcp.example.test/', fetcher })).rejects.toThrow('S256')
  })
})

describe('MCP OAuth authorization code flow', () => {
  const pending: PendingAuthorization = {
    serverId: 'one',
    state: 'state-1',
    verifier: 'verifier-1',
    redirectUri: 'http://127.0.0.1:4100/cb',
    clientId: 'client-1',
    clientSecret: undefined,
    authorizationServer: { ...authorizationServer, authorization_response_iss_parameter_supported: true },
    resource: 'https://mcp.example.test/mcp',
    createdAt: 0,
  }

  it('registers a public client and builds a PKCE authorization URL', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toMatchObject({ redirect_uris: ['http://127.0.0.1:4100/cb'], token_endpoint_auth_method: 'none' })
      return json({ client_id: 'client-1' }, 201)
    })
    const client = await McpOAuthModel.registerClient({ authorizationServer, redirectUri: 'http://127.0.0.1:4100/cb', clientName: 'DSH', fetcher })
    const pkce = await McpOAuthModel.createPkcePair()
    expect(pkce.challenge).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'))
    const url = new URL(
      McpOAuthModel.authorizationUrl({
        endpoints: { resource: 'https://mcp.example.test/mcp', authorizationServer, scopes: [] },
        clientId: client.clientId,
        redirectUri: 'http://127.0.0.1:4100/cb',
        challenge: pkce.challenge,
        state: 'state-1',
      }),
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'http://127.0.0.1:4100/cb',
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
      state: 'state-1',
      resource: 'https://mcp.example.test/mcp',
    })
  })

  it('exchanges the code with the verifier and records expiry', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body))
      expect(form.get('code_verifier')).toBe('verifier-1')
      expect(form.get('grant_type')).toBe('authorization_code')
      expect(form.get('resource')).toBe('https://mcp.example.test/mcp')
      return json({ access_token: 'access-1', token_type: 'Bearer', refresh_token: 'refresh-1', expires_in: 3600 })
    })
    const callback = new URLSearchParams({ code: 'code-1', state: 'state-1', iss: 'https://auth.example.test' })
    expect(await McpOAuthModel.exchangeCode({ pending, callbackParameters: callback, fetcher, now: 1_000 })).toEqual({
      clientId: 'client-1',
      issuer: 'https://auth.example.test',
      tokenEndpoint: 'https://auth.example.test/token',
      resource: 'https://mcp.example.test/mcp',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 3_601_000,
      issuedAt: 1_000,
    })
  })

  it('rejects a callback from another issuer before exchanging the code', async () => {
    const fetcher = vi.fn(async () => json({}))
    const callback = new URLSearchParams({ code: 'code-1', state: 'state-1', iss: 'https://evil.example.test' })
    await expect(McpOAuthModel.exchangeCode({ pending, callbackParameters: callback, fetcher })).rejects.toThrow('issuer')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refreshes near expiry, keeps the refresh token, and reports a failed refresh as sign-in needed', async () => {
    const grant: OAuthGrant = {
      clientId: 'client-1',
      tokenEndpoint: 'https://auth.example.test/token',
      resource: 'https://mcp.example.test/mcp',
      accessToken: 'old',
      refreshToken: 'refresh-1',
      expiresAt: 10_000,
      issuedAt: 0,
    }
    expect(McpOAuthModel.needsRefresh({ grant, now: 0 })).toBe(true)
    expect(McpOAuthModel.needsRefresh({ grant: { ...grant, expiresAt: 600_000 }, now: 0 })).toBe(false)
    const refreshed = await McpOAuthModel.refreshGrant({
      grant,
      fetcher: async () => json({ access_token: 'new', token_type: 'Bearer', expires_in: 60 }),
      now: 5_000,
    })
    expect(refreshed).toMatchObject({ accessToken: 'new', refreshToken: 'refresh-1', expiresAt: 65_000, issuedAt: 5_000 })
    expect(await McpOAuthModel.refreshGrant({ grant, fetcher: async () => json({ error: 'invalid_grant' }, 400) })).toBeUndefined()
    expect(await McpOAuthModel.refreshGrant({ grant: { ...grant, refreshToken: undefined } })).toBeUndefined()
  })

  it('accepts only a bare HTTP(S) origin for the callback', () => {
    expect(McpOAuthModel.callbackRedirectUri({ origin: 'http://127.0.0.1:4100', callbackPath: '/api/cb' })).toBe('http://127.0.0.1:4100/api/cb')
    expect(() => McpOAuthModel.callbackRedirectUri({ origin: 'http://127.0.0.1:4100/path', callbackPath: '/api/cb' })).toThrow()
    expect(() => McpOAuthModel.callbackRedirectUri({ origin: 'file:///tmp', callbackPath: '/api/cb' })).toThrow()
  })
})
