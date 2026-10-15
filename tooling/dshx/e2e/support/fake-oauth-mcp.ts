import type { Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { createAdaptorServer } from '@hono/node-server'
import type { AddressInfo } from 'node:net'
import { Hono } from 'hono'
import { z } from 'zod'

/**
 * A loopback MCP server guarded by its own OAuth 2.1 authorization server, so a journey can sign in for real: RFC 9728
 * protected-resource metadata, RFC 8414 discovery, RFC 7591 registration, an authorization endpoint that approves at
 * once and redirects back with `code`, `state` and `iss`, and a token endpoint that checks the PKCE verifier. The MCP
 * endpoint answers 401 without a token it issued, and with one serves a single `whoami` tool over Streamable HTTP.
 */

export interface FakeOAuthMcp {
  readonly origin: string
  readonly endpoint: string
  /** Client names sent to dynamic registration, in order. */
  readonly registeredClientNames: string[]
  /** Access tokens the MCP endpoint accepted at least once. */
  readonly acceptedTokens: Set<string>
  close(): Promise<void>
}

interface FakeOAuthMcpState {
  readonly codes: Map<string, { readonly challenge: string; readonly redirectUri: string; readonly clientId: string }>
  readonly issuedTokens: Set<string>
  readonly clients: Map<string, readonly string[]>
  readonly registeredClientNames: string[]
  readonly acceptedTokens: Set<string>
}

const registrationSchema = z.object({ client_name: z.string(), redirect_uris: z.array(z.string().url()).min(1) })
const jsonRpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
})
const initializeParamsSchema = z.object({ protocolVersion: z.string() })

const fakes = new WeakMap<Page, FakeOAuthMcp>()

const jsonBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

const s256 = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

export const createFakeOAuthMcpApp = (state: FakeOAuthMcpState): Hono => {
  const app = new Hono()

  app.use('*', async (context, next) => {
    await next()
    context.header('cache-control', 'no-store')
  })

  app.get('/.well-known/oauth-protected-resource', context => {
    const origin = new URL(context.req.url).origin
    return context.json({ resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'] })
  })
  app.get('/.well-known/oauth-protected-resource/mcp', context => {
    const origin = new URL(context.req.url).origin
    return context.json({ resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'] })
  })
  app.get('/.well-known/oauth-authorization-server', context => {
    const origin = new URL(context.req.url).origin
    return context.json({
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
    })
  })
  app.post('/register', async context => {
    const registration = registrationSchema.safeParse(await jsonBody(context.req.raw))
    if (!registration.success) return context.json({ error: 'invalid_client_metadata' }, 400)
    const clientId = `fake-client-${randomUUID()}`
    state.clients.set(clientId, registration.data.redirect_uris)
    state.registeredClientNames.push(registration.data.client_name)
    return context.json(
      {
        client_id: clientId,
        client_name: registration.data.client_name,
        redirect_uris: registration.data.redirect_uris,
        token_endpoint_auth_method: 'none',
      },
      201,
    )
  })
  app.get('/authorize', context => {
    const clientId = context.req.query('client_id') ?? ''
    const redirectUri = context.req.query('redirect_uri') ?? ''
    const challenge = context.req.query('code_challenge') ?? ''
    if (state.clients.get(clientId)?.includes(redirectUri) !== true || context.req.query('code_challenge_method') !== 'S256' || challenge === '') {
      return context.json({ error: 'invalid_request' }, 400)
    }
    const code = randomUUID()
    const origin = new URL(context.req.url).origin
    state.codes.set(code, { challenge, redirectUri, clientId })
    const back = new URL(redirectUri)
    back.searchParams.set('code', code)
    back.searchParams.set('state', context.req.query('state') ?? '')
    back.searchParams.set('iss', origin)
    return context.redirect(back.href, 302)
  })
  app.post('/token', async context => {
    const form = new URLSearchParams(await context.req.text())
    const code = form.get('code') ?? ''
    const grant = state.codes.get(code)
    if (
      form.get('grant_type') !== 'authorization_code' ||
      grant === undefined ||
      grant.clientId !== form.get('client_id') ||
      grant.redirectUri !== form.get('redirect_uri') ||
      s256(form.get('code_verifier') ?? '') !== grant.challenge
    ) {
      return context.json({ error: 'invalid_grant' }, 400)
    }
    state.codes.delete(code)
    const accessToken = `fake-access-${randomUUID()}`
    state.issuedTokens.add(accessToken)
    return context.json({ access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: `fake-refresh-${randomUUID()}` })
  })
  app.all('/mcp', async context => {
    const origin = new URL(context.req.url).origin
    const token = (context.req.header('authorization') ?? '').replace(/^Bearer /, '')
    if (!state.issuedTokens.has(token)) {
      return context.body(null, 401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` })
    }
    state.acceptedTokens.add(token)
    if (context.req.method === 'DELETE') return context.body(null, 200)
    if (context.req.method !== 'POST') return context.body(null, 405)
    const message = jsonRpcSchema.safeParse(await jsonBody(context.req.raw))
    if (!message.success) return context.json({ error: 'invalid JSON-RPC message' }, 400)
    if (message.data.id === undefined) return context.body(null, 202)
    const reply = (result: unknown) => context.json({ jsonrpc: '2.0', id: message.data.id, result }, 200, { 'mcp-session-id': 'fake-session' })
    if (message.data.method === 'initialize') {
      const params = initializeParamsSchema.safeParse(message.data.params)
      return reply({
        protocolVersion: params.success ? params.data.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-oauth-mcp', version: '1.0.0' },
      })
    }
    if (message.data.method === 'tools/list') {
      return reply({ tools: [{ name: 'whoami', description: 'Names the signed-in fake account.', inputSchema: { type: 'object', properties: {} } }] })
    }
    return context.json({ jsonrpc: '2.0', id: message.data.id, error: { code: -32601, message: 'Method not found' } }, 200)
  })
  app.notFound(context => context.json({ error: 'not found' }, 404))
  return app
}

type ListenableServer = {
  once(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  listen(port: number, host: string, listener: () => void): unknown
  address(): AddressInfo | string | null
  close(listener: () => void): unknown
}

const listen = (server: ListenableServer): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

export const startFakeOAuthMcp = async (page: Page): Promise<FakeOAuthMcp> => {
  const state: FakeOAuthMcpState = {
    codes: new Map(),
    issuedTokens: new Set(),
    clients: new Map(),
    registeredClientNames: [],
    acceptedTokens: new Set(),
  }
  const server = createAdaptorServer({ fetch: createFakeOAuthMcpApp(state).fetch })
  await listen(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('The fake OAuth MCP server has no port.')
  const origin = `http://127.0.0.1:${String(address.port)}`
  const fake: FakeOAuthMcp = {
    origin,
    endpoint: `${origin}/mcp`,
    registeredClientNames: state.registeredClientNames,
    acceptedTokens: state.acceptedTokens,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
  fakes.set(page, fake)
  return fake
}

export const fakeOAuthMcpFor = (page: Page): FakeOAuthMcp => {
  const fake = fakes.get(page)
  if (fake === undefined) throw new Error('The fake OAuth MCP server was not started for this scenario.')
  return fake
}

export const stopFakeOAuthMcp = async (page: Page): Promise<void> => {
  const fake = fakes.get(page)
  if (fake === undefined) return
  fakes.delete(page)
  await fake.close()
}
