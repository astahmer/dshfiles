import type { Page } from '@playwright/test'
import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
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

const registrationSchema = z.object({ client_name: z.string(), redirect_uris: z.array(z.string().url()).min(1) })
const jsonRpcSchema = z.object({ jsonrpc: z.literal('2.0'), id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.unknown().optional() })
const initializeParamsSchema = z.object({ protocolVersion: z.string() })

const fakes = new WeakMap<Page, FakeOAuthMcp>()

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise(resolve => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => resolve(body))
  })

const json = (response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(value))
}

const s256 = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

export const startFakeOAuthMcp = async (page: Page): Promise<FakeOAuthMcp> => {
  const codes = new Map<string, { readonly challenge: string; readonly redirectUri: string; readonly clientId: string }>()
  const issuedTokens = new Set<string>()
  const clients = new Map<string, readonly string[]>()
  const registeredClientNames: string[] = []
  const acceptedTokens = new Set<string>()
  let origin = ''

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', origin)
      const body = await readBody(request)
      if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp') {
        return json(response, 200, { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ['header'] })
      }
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return json(response, 200, {
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
      }
      if (url.pathname === '/register' && request.method === 'POST') {
        const registration = registrationSchema.safeParse(JSON.parse(body || '{}'))
        if (!registration.success) return json(response, 400, { error: 'invalid_client_metadata' })
        const clientId = `fake-client-${randomUUID()}`
        clients.set(clientId, registration.data.redirect_uris)
        registeredClientNames.push(registration.data.client_name)
        return json(response, 201, { client_id: clientId, client_name: registration.data.client_name, redirect_uris: registration.data.redirect_uris, token_endpoint_auth_method: 'none' })
      }
      if (url.pathname === '/authorize') {
        const clientId = url.searchParams.get('client_id') ?? ''
        const redirectUri = url.searchParams.get('redirect_uri') ?? ''
        const challenge = url.searchParams.get('code_challenge') ?? ''
        if (clients.get(clientId)?.includes(redirectUri) !== true || url.searchParams.get('code_challenge_method') !== 'S256' || challenge === '') {
          return json(response, 400, { error: 'invalid_request' })
        }
        const code = randomUUID()
        codes.set(code, { challenge, redirectUri, clientId })
        const back = new URL(redirectUri)
        back.searchParams.set('code', code)
        back.searchParams.set('state', url.searchParams.get('state') ?? '')
        back.searchParams.set('iss', origin)
        response.writeHead(302, { location: back.href })
        return response.end()
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(body)
        const grant = codes.get(form.get('code') ?? '')
        if (
          form.get('grant_type') !== 'authorization_code' ||
          grant === undefined ||
          grant.clientId !== form.get('client_id') ||
          grant.redirectUri !== form.get('redirect_uri') ||
          s256(form.get('code_verifier') ?? '') !== grant.challenge
        ) {
          return json(response, 400, { error: 'invalid_grant' })
        }
        codes.delete(form.get('code') ?? '')
        const accessToken = `fake-access-${randomUUID()}`
        issuedTokens.add(accessToken)
        return json(response, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: `fake-refresh-${randomUUID()}` })
      }
      if (url.pathname === '/mcp') {
        const token = (request.headers.authorization ?? '').replace(/^Bearer /, '')
        if (!issuedTokens.has(token)) {
          response.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` })
          return response.end()
        }
        acceptedTokens.add(token)
        if (request.method !== 'POST') {
          response.writeHead(request.method === 'DELETE' ? 200 : 405)
          return response.end()
        }
        const message = jsonRpcSchema.safeParse(JSON.parse(body || '{}'))
        if (!message.success) return json(response, 400, { error: 'invalid JSON-RPC message' })
        if (message.data.id === undefined) {
          response.writeHead(202)
          return response.end()
        }
        const reply = (result: unknown): void => json(response, 200, { jsonrpc: '2.0', id: message.data.id, result }, { 'mcp-session-id': 'fake-session' })
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
        return json(response, 200, { jsonrpc: '2.0', id: message.data.id, error: { code: -32601, message: 'Method not found' } })
      }
      return json(response, 404, { error: 'not found' })
    })()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('The fake OAuth MCP server has no port.')
  origin = `http://127.0.0.1:${String(address.port)}`
  const fake: FakeOAuthMcp = {
    origin,
    endpoint: `${origin}/mcp`,
    registeredClientNames,
    acceptedTokens,
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
