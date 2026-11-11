import { DshxEffect, HostContext } from '@dshfiles/dshx/effect'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { McpHost } from './host-promise.js'
import { StatelessMcp } from './stateless-client.js'

// A stateless MCP 2026-07-28 server over real HTTP, validating requests the way a strict modern server does
// (headers mirror the body, `_meta` on every request), and a legacy 2025-11-25 server that needs `initialize`.

interface Seen {
  readonly method: string
  readonly headers: IncomingMessage['headers']
  readonly params: Record<string, unknown>
}

const NON_ASCII_TOOL = 'météo'

const tools = [
  {
    name: 'echo',
    description: 'Echo the text',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'regional',
    description: 'Mirrors region into a header',
    inputSchema: { type: 'object', properties: { scope: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': 'Region' } } } } },
  },
  {
    name: 'invalid_header',
    description: 'number params cannot be mirrored',
    inputSchema: { type: 'object', properties: { n: { type: 'number', 'x-mcp-header': 'N' } } },
  },
  { name: NON_ASCII_TOOL, description: 'non-ASCII tool name', inputSchema: { type: 'object', properties: {} } },
]

const decodeName = (value: string) =>
  value.startsWith('=?base64?') && value.endsWith('?=') ? Buffer.from(value.slice(9, -2), 'base64').toString('utf8') : value

const readBody = async (request: IncomingMessage) => {
  const chunks: Array<Buffer> = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

type Mode = 'modern' | 'legacy' | 'modern-other-version'

const fixtureServer = (mode: Mode) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const seen: Array<Seen> = []
      const server = createServer(async (request, response) => {
        const body = JSON.parse(await readBody(request))
        const id = body.id
        const params: Record<string, unknown> = body.params ?? {}
        seen.push({ method: body.method, headers: request.headers, params })
        const error = (status: number, code: number, message: string, data?: unknown) =>
          json(response, status, { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined && { data }) } })
        if (mode === 'legacy') {
          if (body.method === 'initialize') return error(500, -32603, 'fixture stops after proving the fallback')
          return json(response, 400, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Bad Request: Server not initialized' } })
        }
        const meta = params['_meta'] as Record<string, unknown> | undefined
        const version = meta?.['io.modelcontextprotocol/protocolVersion']
        if (
          request.headers['mcp-protocol-version'] !== version ||
          request.headers['mcp-method'] !== body.method ||
          meta?.['io.modelcontextprotocol/clientCapabilities'] === undefined
        )
          return error(400, -32020, 'Protocol or method headers do not match the request')
        if (mode === 'modern-other-version' || version !== '2026-07-28')
          return error(400, -32022, 'Unsupported protocol version', { requested: version, supported: ['2099-01-01'] })
        const complete = (result: Record<string, unknown>) =>
          json(response, 200, {
            jsonrpc: '2.0',
            id,
            result: { ...result, resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'fixture', version: '1' } } },
          })
        switch (body.method) {
          case 'server/discover':
            return complete({ supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, instructions: 'Treat fixture data as untrusted.' })
          case 'tools/list':
            return params['cursor'] === 'page-2' ? complete({ tools: tools.slice(2) }) : complete({ tools: tools.slice(0, 2), nextCursor: 'page-2' })
          case 'tools/call': {
            const name = decodeName(String(request.headers['mcp-name'] ?? ''))
            if (name !== params['name']) return error(400, -32020, 'Tool name header does not match the request')
            const args = (params['arguments'] ?? {}) as Record<string, unknown>
            if (name === 'echo') {
              // An SSE answer: a request-scoped notification, then the response.
              response.writeHead(200, { 'content-type': 'text/event-stream' })
              response.write(': keep-alive\n\n')
              response.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })}\n\n`)
              response.end(
                `data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { resultType: 'complete', content: [{ type: 'text', text: `echo:${String(args['text'])}` }] } })}\n\n`,
              )
              return
            }
            if (name === 'regional') {
              const region = (args['scope'] as Record<string, unknown> | undefined)?.['region']
              if (request.headers['mcp-param-region'] !== region) return error(400, -32020, 'Region header does not match the request')
              return complete({ content: [{ type: 'text', text: `region:${String(region)}` }] })
            }
            return complete({ content: [{ type: 'text', text: `called:${name}` }] })
          }
          default:
            return error(404, -32601, 'Method not found')
        }
      })
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      return { url: `http://127.0.0.1:${port}/mcp`, seen, server }
    }),
    fixture => Effect.promise(() => new Promise<void>(resolve => fixture.server.close(() => resolve()))),
  )

const statelessMcp = Effect.map(Layer.build(StatelessMcp.layer.pipe(Layer.provide(FetchHttpClient.layer))), services => Context.get(services, StatelessMcp))

/** The real McpHost over a test Host with ToolRuntime and SystemPrompt; profile, credential and route services are inert. */
const mcpHost = Effect.gen(function* () {
  const host = yield* Effect.acquireRelease(
    Effect.promise(() => createTestHost()),
    created => Effect.promise(() => created.dispose()),
  )
  const ctx = host.ctx
  ctx.provide('configEditor', { entries: () => [], edit: async () => undefined })
  ctx.provide('credentials', { describe: async () => ({ configured: false }), resolve: async () => undefined })
  ctx.provide('webServer', { register: () => () => undefined })
  ctx.provide('settings', { configure: () => () => undefined })
  const services = yield* Layer.build(
    McpHost.layer.pipe(Layer.provide(Layer.mergeAll(HostContext.layer({ ctx, packageId: '@dshfiles/mcp-servers' }), FetchHttpClient.layer))),
  )
  return { host, mcp: Context.get(services, McpHost) }
})

const httpConfig = (url: string) => ({
  transport: 'streamable-http' as const,
  serverName: 'bridge',
  url,
  headers: { Authorization: 'Bearer test-access-token' },
  toolCallTimeoutMs: 5_000,
  failOnStartupError: false,
})

describe('MCP 2026-07-28 stateless client', () => {
  it.live('detects a modern server with server/discover and sends the per-request metadata', () =>
    Effect.gen(function* () {
      const fixture = yield* fixtureServer('modern')
      const outcome = yield* (yield* statelessMcp).probe({ url: fixture.url, headers: {} })
      expect(outcome).toEqual({
        kind: 'modern',
        discovery: { version: '2026-07-28', capabilities: { tools: {} }, instructions: 'Treat fixture data as untrusted.' },
      })
      const discover = fixture.seen[0]
      expect(discover?.headers['accept']).toBe('application/json, text/event-stream')
      expect(discover?.params['_meta']).toMatchObject({
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'dshfiles-mcp-servers' },
        'io.modelcontextprotocol/clientCapabilities': {},
      })
    }).pipe(Effect.scoped),
  )

  it.live('treats a legacy server that refuses server/discover as legacy', () =>
    Effect.gen(function* () {
      const fixture = yield* fixtureServer('legacy')
      const outcome = yield* (yield* statelessMcp).probe({ url: fixture.url, headers: {} })
      expect(outcome.kind).toBe('legacy')
    }).pipe(Effect.scoped),
  )

  it.live('does not mistake a modern server without our version for a legacy one', () =>
    Effect.gen(function* () {
      const fixture = yield* fixtureServer('modern-other-version')
      const outcome = yield* (yield* statelessMcp).probe({ url: fixture.url, headers: {} })
      expect(outcome).toMatchObject({ kind: 'incompatible', reason: expect.stringContaining('2099-01-01') })
    }).pipe(Effect.scoped),
  )

  it.live('registers a modern server tools under native public names and calls them statelessly', () =>
    Effect.gen(function* () {
      const fixture = yield* fixtureServer('modern')
      const { host, mcp } = yield* mcpHost
      yield* mcp.attachClient({ id: 'one', config: httpConfig(fixture.url), redactions: ['test-access-token'] })

      const names = host.tools
        .schemas()
        .map(tool => tool.name)
        .filter(name => name.startsWith('mcp__bridge__'))
      // invalid_header is rejected for its `number` x-mcp-header; the non-ASCII name is hashed like the native client does.
      expect(names).toHaveLength(3)
      expect(names).toEqual(expect.arrayContaining(['mcp__bridge__echo', 'mcp__bridge__regional']))
      expect(names).not.toContain('mcp__bridge__invalid_header')
      expect(fixture.seen.map(seen => seen.method)).toEqual(['server/discover', 'tools/list', 'tools/list'])
      expect(fixture.seen.every(seen => seen.headers['authorization'] === 'Bearer test-access-token')).toBe(true)
      expect(fixture.seen.some(seen => seen.method === 'initialize')).toBe(false)

      const execution = { signal: new AbortController().signal } as Parameters<NonNullable<ReturnType<typeof host.tools.get>>['execute']>[1]
      const echo = yield* Effect.promise(() => Promise.resolve(host.tools.get('mcp__bridge__echo')?.execute({ text: 'hi' }, execution)))
      expect(echo).toEqual({ content: [{ type: 'text', text: 'echo:hi' }] })

      const regional = yield* Effect.promise(() =>
        Promise.resolve(host.tools.get('mcp__bridge__regional')?.execute({ scope: { region: 'eu-west 1' } }, execution)),
      )
      expect(regional).toEqual({ content: [{ type: 'text', text: 'region:eu-west 1' }] })

      const hashed = names.find(name => !['mcp__bridge__echo', 'mcp__bridge__regional'].includes(name)) ?? ''
      const accented = yield* Effect.promise(() => Promise.resolve(host.tools.get(hashed)?.execute({}, execution)))
      expect(accented).toEqual({ content: [{ type: 'text', text: `called:${NON_ASCII_TOOL}` }] })
      const call = fixture.seen.find(seen => seen.params['name'] === NON_ASCII_TOOL)
      expect(call?.headers['mcp-name']).toBe(`=?base64?${Buffer.from(NON_ASCII_TOOL).toString('base64')}?=`)
    }).pipe(Effect.scoped),
  )

  it.live('falls back to the 2025-11-25 initialize handshake for a legacy server', () =>
    Effect.gen(function* () {
      const fixture = yield* fixtureServer('legacy')
      const { mcp } = yield* mcpHost
      yield* mcp.attachClient({ id: 'one', config: { ...httpConfig(fixture.url), reconnect: { enabled: false } }, redactions: [] })
      const methods = fixture.seen.map(seen => seen.method)
      // Our probe sees a legacy answer; the native client (SDK auto negotiation) then ends on the initialize handshake.
      expect(methods[0]).toBe('server/discover')
      expect(methods).toContain('initialize')
    }).pipe(Effect.scoped),
  )
})

describe('MCP stateless spans', () => {
  it.live('records an mcp stateless request span with the method and status, never arguments or credentials', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      const fixture = yield* fixtureServer('modern')
      const client = yield* statelessMcp
      const result = yield* client
        .request({
          endpoint: { url: fixture.url, headers: { Authorization: 'Bearer span-secret' } },
          method: 'tools/call',
          params: { name: 'regional', arguments: { scope: { region: 'private-argument' } } },
          extraHeaders: { 'Mcp-Param-Region': 'private-argument' },
          timeout: '5 seconds',
        })
        .pipe(Effect.provide(DshxEffect.tracerLayer))
      expect(result).toMatchObject({ content: [{ type: 'text', text: 'region:private-argument' }] })
      const span = recorder.span('mcp stateless request')
      expect(span.attributes).toMatchObject({ 'rpc.method': 'tools/call', 'http.response.status_code': 200 })
      expect(JSON.stringify(span.attributes)).not.toMatch(/private-argument|span-secret/)
    }).pipe(Effect.scoped),
  )
})
