import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHostApiClient, defineHost } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { sessionsApi } from '@dshfiles/session-controller/sessions-api'
import { afterEach, expect, it } from 'vitest'
import { claudeCommand } from './claude-command.js'
import { mcpEndpointApi } from './endpoint-api.js'
import endpointHost from './host.js'
import { isLocalAddress } from './local-address.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const unused = () => Promise.reject(new Error('not used by this test'))

/** The sessions owner stands in for session-controller: it records what the MCP tools asked for. */
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-endpoint-'))
  const host = await createTestHost()
  cleanups.push(async () => {
    await host.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const ctx = host.ctx
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'project-1', title: 'sample', path: '/tmp/sample', sessionIds: new Set<string>() }] })
  const routes: WebRoute[] = []
  ctx.provide('webServer', {
    port: 3080,
    host: '127.0.0.1',
    protocol: 'http:',
    getOrigin: () => 'http://127.0.0.1:3080',
    register: (route: WebRoute) => {
      routes.push(route)
      return () => routes.splice(routes.indexOf(route), 1)
    },
  })
  const created: unknown[] = []
  await host.mount(
    defineHost({
      name: '@dshfiles/session-controller',
      apis: [
        sessionsApi.host({
          list: () => ({ threads: [{ sessionId: 'session-1', title: 'Fix login', running: false, updatedAt: 1 }], total: 1, truncated: false }),
          messages: ({ input }) => ({ sessionId: input.sessionId, running: false, entries: [{ seq: 3, role: 'assistant', text: 'Done.' }], truncated: false }),
          create: ({ input }) => {
            created.push(input)
            return { sessionId: 'session-2' }
          },
          prompt: () => ({ accepted: true as const }),
          wait: () => ({ status: 'idle' as const }),
          interrupt: () => ({ interrupted: true as const }),
          command: unused,
          message: unused,
          compact: unused,
          selectModel: unused,
          selectAgent: unused,
          instructions: unused,
          setInstruction: unused,
          generate: unused,
        }),
      ],
    }),
    { packageId: '@dshfiles/session-controller' },
  )
  await host.mount(endpointHost, { packageId: '@dshfiles/mcp-endpoint' })
  const route = routes.find(candidate => candidate.path === '/mcp')
  if (route === undefined) throw new Error('the Host registered no /mcp route')
  const server: Server = createServer((request, response) => void route.handler(request, response))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise(resolve => server.close(() => resolve())))
  // SAFETY: a TCP server listening on a port reports an AddressInfo, never a pipe path.
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
  return { ctx, url, created, endpoint: createHostApiClient(ctx, mcpEndpointApi, '@acme/settings') }
}

const connect = async (input: { readonly url: string; readonly token: string }) => {
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(input.url), { requestInit: { headers: { authorization: `Bearer ${input.token}` } } })
  await client.connect(transport)
  cleanups.push(() => client.close())
  return client
}

const post = (input: { readonly url: string; readonly headers?: Record<string, string> }) =>
  fetch(input.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...input.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })

it('refuses every client until a token is issued, then only the bearer of the current token', async () => {
  const { url, endpoint } = await fixture()
  const before = await post({ url })
  expect(before.status).toBe(401)
  expect(before.headers.get('www-authenticate')).toBe('Bearer realm="dsh"')
  expect(await before.text()).toContain('No MCP token has been issued yet')

  const { token, status } = await endpoint.rotateToken({})
  expect(token).toMatch(/^dshmcp_[\w-]{43}$/)
  expect(status).toMatchObject({
    path: '/mcp',
    localUrl: 'http://127.0.0.1:3080/mcp',
    lanUrl: null,
    lanEnabled: false,
    token: { createdAt: expect.any(Number) },
  })
  expect(JSON.stringify(await endpoint.status({}))).not.toContain(token)

  expect((await post({ url, headers: { authorization: 'Bearer dshmcp_wrong' } })).status).toBe(401)
  expect((await post({ url, headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example' } })).status).toBe(403)
  expect((await post({ url, headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
  const streamRequest = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' } })
  expect([streamRequest.status, streamRequest.headers.get('allow')]).toEqual([405, 'POST'])

  const rotated = await endpoint.rotateToken({})
  expect((await post({ url, headers: { authorization: `Bearer ${token}` } })).status).toBe(401)
  await endpoint.revokeToken({ confirm: true })
  expect((await post({ url, headers: { authorization: `Bearer ${rotated.token}` } })).status).toBe(401)
})

it('drives threads through MCP tools backed by the sessions API, one span per request', async () => {
  const { url, endpoint, created } = await fixture()
  const { token } = await endpoint.rotateToken({})
  const client = await connect({ url, token })
  const tools = await client.listTools()
  expect(tools.tools.map(tool => tool.name).toSorted()).toEqual([
    'create_thread',
    'list_projects',
    'list_threads',
    'read_thread',
    'send_message',
    'stop_turn',
    'wait_for_turn',
  ])

  const recorder = recordSpans()
  try {
    const listed = await client.callTool({ name: 'list_threads', arguments: { limit: 5 } })
    expect(JSON.stringify(listed.content)).toContain('Fix login')
    const span = recorder.span('mcp request')
    expect(span.attributes).toMatchObject({ 'dshx.mcp.outcome': 'accepted', 'mcp.method.name': 'tools/call', 'gen_ai.tool.name': 'list_threads' })
  } finally {
    recorder.stop()
  }

  const result = await client.callTool({ name: 'create_thread', arguments: { cwd: '/tmp/project', prompt: 'Say hi', model: { provider: 'p', model: 'm' } } })
  expect(JSON.stringify(result.content)).toContain('session-2')
  expect(created).toEqual([{ cwd: '/tmp/project', prompt: 'Say hi', model: { provider: 'p', model: 'm' } }])
  const read = await client.callTool({ name: 'read_thread', arguments: { sessionId: 'session-2' } })
  expect(JSON.stringify(read.content)).toContain('Done.')
  const waited = await client.callTool({ name: 'wait_for_turn', arguments: { sessionId: 'session-2', timeoutMs: 1_000 } })
  expect(JSON.stringify(waited.content)).toContain('idle')

  const refused = await client.callTool({ name: 'send_message', arguments: { sessionId: 'session-2', text: 'x', mode: 'nope' } })
  expect(refused.isError).toBe(true)
})

it('keeps LAN access off until the user turns it on', async () => {
  const { endpoint } = await fixture()
  expect((await endpoint.status({})).lanEnabled).toBe(false)
  expect((await endpoint.setLanAccess({ enabled: true })).lanEnabled).toBe(true)
  expect((await endpoint.setLanAccess({ enabled: false })).lanEnabled).toBe(false)
})

it('treats only loopback and this machine’s own addresses as local', () => {
  expect(isLocalAddress('127.0.0.1')).toBe(true)
  expect(isLocalAddress('::ffff:127.0.0.1')).toBe(true)
  expect(isLocalAddress('::1')).toBe(true)
  expect(isLocalAddress('203.0.113.9')).toBe(false)
  expect(isLocalAddress(undefined)).toBe(false)
})

it('builds the Claude Code command with the endpoint URL and bearer header', () => {
  expect(claudeCommand({ url: 'http://127.0.0.1:3080/mcp', token: 'dshmcp_abc' })).toBe(
    'claude mcp add --transport http dsh http://127.0.0.1:3080/mcp --header "Authorization: Bearer dshmcp_abc"',
  )
})
