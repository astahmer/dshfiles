import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  authorizationUrl,
  callbackRedirectUri,
  createPkcePair,
  discoverOAuth,
  exchangeCode,
  needsRefresh,
  refreshGrant,
  registerClient,
  type OAuthGrant,
} from './oauth.js'

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const routes = (table: Record<string, unknown>) =>
  vi.fn(async (input: URL, _init?: RequestInit) => (input.href in table ? json(table[input.href]) : new Response('missing', { status: 404 })))

describe('MCP OAuth discovery', () => {
  it('follows protected-resource metadata to the authorization server', async () => {
    const fetcher = routes({
      'https://mcp.example.test/.well-known/oauth-protected-resource/mcp': {
        resource: 'https://mcp.example.test/mcp',
        authorization_servers: ['https://auth.example.test'],
        scopes_supported: ['read'],
      },
      'https://auth.example.test/.well-known/oauth-authorization-server': {
        authorization_endpoint: 'https://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
        registration_endpoint: 'https://auth.example.test/register',
        code_challenge_methods_supported: ['S256'],
      },
    })
    expect(await discoverOAuth('https://mcp.example.test/mcp', fetcher)).toEqual({
      resource: 'https://mcp.example.test/mcp',
      authorizationEndpoint: 'https://auth.example.test/authorize',
      tokenEndpoint: 'https://auth.example.test/token',
      registrationEndpoint: 'https://auth.example.test/register',
      scopes: ['read'],
    })
  })

  it('falls back to the server origin and rejects plain-HTTP remote endpoints', async () => {
    const fetcher = routes({
      'https://mcp.example.test/.well-known/oauth-authorization-server': {
        authorization_endpoint: 'http://auth.example.test/authorize',
        token_endpoint: 'https://auth.example.test/token',
      },
    })
    await expect(discoverOAuth('https://mcp.example.test/mcp', fetcher)).rejects.toThrow('HTTPS')
  })

  it('refuses a server without PKCE S256', async () => {
    const fetcher = routes({
      'https://mcp.example.test/.well-known/oauth-authorization-server': {
        authorization_endpoint: 'https://mcp.example.test/authorize',
        token_endpoint: 'https://mcp.example.test/token',
        code_challenge_methods_supported: ['plain'],
      },
    })
    await expect(discoverOAuth('https://mcp.example.test/', fetcher)).rejects.toThrow('S256')
  })
})

describe('MCP OAuth authorization code flow', () => {
  it('registers a public client and builds a PKCE authorization URL', async () => {
    const fetcher = vi.fn(async (_input: URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ redirect_uris: ['http://127.0.0.1:4100/cb'], token_endpoint_auth_method: 'none' })
      return json({ client_id: 'client-1' })
    })
    const client = await registerClient({ registrationEndpoint: 'https://auth.example.test/register', redirectUri: 'http://127.0.0.1:4100/cb', clientName: 'DSH' }, fetcher)
    const pkce = createPkcePair()
    expect(pkce.challenge).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'))
    const url = new URL(
      authorizationUrl({
        endpoints: {
          resource: 'https://mcp.example.test/mcp',
          authorizationEndpoint: 'https://auth.example.test/authorize',
          tokenEndpoint: 'https://auth.example.test/token',
          registrationEndpoint: undefined,
          scopes: [],
        },
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
    const fetcher = vi.fn(async (_input: URL, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('code_verifier')).toBe('verifier-1')
      expect(form.get('grant_type')).toBe('authorization_code')
      return json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600 })
    })
    const grant = await exchangeCode(
      {
        serverId: 'one',
        verifier: 'verifier-1',
        redirectUri: 'http://127.0.0.1:4100/cb',
        clientId: 'client-1',
        clientSecret: undefined,
        tokenEndpoint: 'https://auth.example.test/token',
        resource: 'https://mcp.example.test/mcp',
        createdAt: 0,
      },
      'code-1',
      fetcher,
      1_000,
    )
    expect(grant).toEqual({
      clientId: 'client-1',
      tokenEndpoint: 'https://auth.example.test/token',
      resource: 'https://mcp.example.test/mcp',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 3_601_000,
      issuedAt: 1_000,
    })
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
    expect(needsRefresh(grant, 0)).toBe(true)
    expect(needsRefresh({ ...grant, expiresAt: 600_000 }, 0)).toBe(false)
    const refreshed = await refreshGrant(grant, async () => json({ access_token: 'new', expires_in: 60 }), 5_000)
    expect(refreshed).toMatchObject({ accessToken: 'new', refreshToken: 'refresh-1', expiresAt: 65_000, issuedAt: 5_000 })
    expect(await refreshGrant(grant, async () => json({ error: 'invalid_grant' }, 400))).toBeUndefined()
    expect(await refreshGrant({ ...grant, refreshToken: undefined })).toBeUndefined()
  })

  it('accepts only a bare HTTP(S) origin for the callback', () => {
    expect(callbackRedirectUri('http://127.0.0.1:4100', '/api/cb')).toBe('http://127.0.0.1:4100/api/cb')
    expect(() => callbackRedirectUri('http://127.0.0.1:4100/path', '/api/cb')).toThrow()
    expect(() => callbackRedirectUri('file:///tmp', '/api/cb')).toThrow()
  })
})
