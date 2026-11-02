import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import * as Schema from 'effect/Schema'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import mcpServersHost from './host.js'

// The OAuth pending-authorization map and the manager's wire failures, through the mounted Host, pinned before the
// module-level Map becomes a Ref with expiry and McpManagerOperationError becomes tagged errors. The OAuth provider is
// a real loopback HTTP server.

type Route = { readonly path: string; readonly handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }

const servers: Server[] = []
const routes: Route[] = []
type CredentialRecord = { readonly kind: string; readonly payload: unknown }

const grants = new Map<string, CredentialRecord>()
const tokenRequests: string[] = []
let host: TestHost
let providerBase = ''
let callbackBase = ''

const listen = async (handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> => {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${String(Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address()).port)}`
}

const json = (response: ServerResponse, body: Readonly<Record<string, string | number | readonly string[]>>, status = 200): void => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

const startProvider = () =>
  listen((request, response) => {
    const path = new URL(request.url ?? '/', 'http://provider').pathname
    request.resume()
    request.on('end', () => {
      if (path === '/.well-known/oauth-protected-resource/mcp')
        return json(response, { resource: `${providerBase}/mcp`, authorization_servers: [providerBase] })
      if (path === '/.well-known/oauth-authorization-server')
        return json(response, {
          issuer: providerBase,
          authorization_endpoint: `${providerBase}/authorize`,
          token_endpoint: `${providerBase}/token`,
          registration_endpoint: `${providerBase}/register`,
          code_challenge_methods_supported: ['S256'],
        })
      if (path === '/register') return json(response, { client_id: 'loopback-client' }, 201)
      if (path === '/token') {
        tokenRequests.push(path)
        return json(response, { access_token: 'access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-token' })
      }
      response.writeHead(404)
      response.end()
    })
  })

const wireEnvelope = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Unknown }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})
const authorizeOutput = Schema.Struct({ authorizationUrl: Schema.String })

type ApiInput = Parameters<TestHost['connection']['requestApi']>[0]['input']

const call = async (method: string, input: ApiInput) => {
  const response = await host.connection.requestApi({ packageId: '@dshfiles/mcp-servers', apiId: 'mcp-servers', method, version: 1, input })
  return Schema.decodeUnknownSync(wireEnvelope)(await response.json()).result
}

const authorize = async (): Promise<string> => {
  const result = await call('authorize', { id: 'oauth-server', origin: callbackBase })
  if (!result.ok) throw new Error(`authorize failed: ${result.error.message}`)
  const url = new URL(Schema.decodeUnknownSync(authorizeOutput)(result.value.output).authorizationUrl)
  const state = url.searchParams.get('state')
  if (state === null) throw new Error('The authorization URL carries no state.')
  return state
}

const callback = async (query: string): Promise<{ readonly status: number; readonly text: string }> => {
  const response = await fetch(`${callbackBase}/api/dshfiles-mcp-servers/oauth/callback?${query}`)
  return { status: response.status, text: await response.text() }
}

beforeAll(async () => {
  providerBase = await startProvider()
  callbackBase = await listen((request, response) => {
    const route = routes.find(candidate => candidate.path === new URL(request.url ?? '/', 'http://callback').pathname)
    if (route === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    void route.handler(request, response)
  })
  const config = {
    servers: [
      {
        id: 'oauth-server',
        name: 'OAuth server',
        serverName: 'oauth',
        enabled: false,
        transport: 'streamable-http',
        url: `${providerBase}/mcp`,
        headerRefs: {},
        auth: 'oauth',
      },
      {
        id: 'plain-server',
        name: 'Plain server',
        serverName: 'plain',
        enabled: false,
        transport: 'streamable-http',
        url: `${providerBase}/plain`,
        headerRefs: {},
      },
    ],
  }
  host = await createTestHost()
  const ctx = host.ctx
  ctx.provide('webServer', {
    port: 3080,
    host: '127.0.0.1',
    protocol: 'http:',
    register: (route: Route) => {
      routes.push(route)
      return () => routes.splice(routes.indexOf(route), 1)
    },
  })
  ctx.provide('configEditor', {
    entries: () => [{ options: { id: 'mcp-servers', name: '@dshfiles/mcp-servers', config }, fiber: {} }],
    edit: async () => undefined,
  })
  ctx.provide('credentials', {
    readRecord: async (key: string) => grants.get(key),
    modifyRecord: async (key: string, update: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      const next = await update(grants.get(key))
      if (next !== undefined) grants.set(key, next)
    },
    deleteRecord: async (key: string) => {
      grants.delete(key)
    },
    describe: async () => ({ configured: false }),
    resolve: async () => undefined,
  })
  ctx.provide('settings', { configure: () => () => undefined })
  await ctx.plugin(LocalSubprocessRuntime)
  await host.mount(mcpServersHost, { packageId: '@dshfiles/mcp-servers', config })
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(async () => {
  await host.dispose()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

describe('OAuth pending authorizations', () => {
  it('an unknown state is refused as expired or already used', async () => {
    expect(await callback('state=never-issued&code=abc')).toMatchObject({ status: 400, text: expect.stringContaining('expired or was already used') })
  })

  it('a valid state exchanges the code once, stores the grant, and cannot be replayed', async () => {
    const state = await authorize()
    const exchanged = await callback(`state=${state}&code=authorization-code`)
    expect(exchanged).toMatchObject({ status: 200, text: expect.stringContaining('Signed in.') })
    expect(tokenRequests.length).toBeGreaterThanOrEqual(1)
    expect([...grants.values()].map(grant => grant.kind)).toContain('grant')
    expect(await callback(`state=${state}&code=authorization-code`)).toMatchObject({
      status: 400,
      text: expect.stringContaining('expired or was already used'),
    })
  })

  it('a provider error consumes the state', async () => {
    const state = await authorize()
    expect(await callback(`state=${state}&error=access_denied`)).toMatchObject({ status: 400, text: expect.stringContaining('did not authorize DSH') })
    expect(await callback(`state=${state}&code=late-code`)).toMatchObject({ status: 400, text: expect.stringContaining('expired or was already used') })
  })

  it('a callback without a code consumes the state', async () => {
    const state = await authorize()
    expect(await callback(`state=${state}`)).toMatchObject({ status: 400, text: expect.stringContaining('no authorization code') })
    expect(await callback(`state=${state}&code=late-code`)).toMatchObject({ status: 400 })
  })

  it('a pending authorization expires after 10 minutes, swept on the next callback', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() })
    const state = await authorize()
    vi.setSystemTime(Date.now() + 600_001)
    expect(await callback(`state=${state}&code=authorization-code`)).toMatchObject({
      status: 400,
      text: expect.stringContaining('expired or was already used'),
    })
  })

  it('a pending authorization younger than 10 minutes still completes', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() })
    const state = await authorize()
    vi.setSystemTime(Date.now() + 599_000)
    expect(await callback(`state=${state}&code=authorization-code`)).toMatchObject({ status: 200 })
  })
})

describe('MCP manager wire failures', () => {
  it.each([
    {
      name: 'authorize for an unknown server',
      method: 'authorize',
      input: { id: 'missing', origin: 'http://127.0.0.1:3080' },
      message: 'MCP server was not found.',
    },
    {
      name: 'authorize for a server without OAuth',
      method: 'authorize',
      input: { id: 'plain-server', origin: 'http://127.0.0.1:3080' },
      message: 'This server does not use OAuth sign-in.',
    },
    { name: 'sign out of an unknown server', method: 'signOut', input: { id: 'missing' }, message: 'MCP server was not found.' },
    { name: 'connect an unknown server', method: 'setConnection', input: { id: 'missing', connected: true }, message: 'MCP server was not found.' },
  ])('$name is mcp-manager-operation-error carrying the thrown message', async ({ method, input, message }) => {
    expect(await call(method, input)).toEqual({ ok: false, error: { code: 'mcp-manager-operation-error', message } })
  })
})
