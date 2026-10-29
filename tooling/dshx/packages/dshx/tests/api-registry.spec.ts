import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { defineApi, dshxRegistryApi, isApiOwnerMissing, method, type ApiCaller, type RegistryListing } from '../src/api/index.js'
import { publishedJsonSchema, toToolSchema } from '../src/api/json-schema.js'
import { ApiRuntimeModel } from '../src/api/runtime.js'
import { createHostApiClient, defineHost, isApiServed, listApis } from '../src/host/index.js'
import { createTestHost } from '../src/testing/index.js'

const threads = defineApi({
  id: 'threads',
  version: 1,
  owner: '@test/threads',
  methods: {
    status: method({
      input: z.object({ path: z.string().min(1).optional() }).strict(),
      output: z.object({ path: z.string(), unlanded: z.number().int() }),
      description: 'Revisions of a thread workspace not yet on main.',
      tool: { name: 'test_thread_status', readOnly: true, render: output => `status ${JSON.stringify(output)}` },
    }),
    land: method({
      input: z.object({ path: z.string().min(1) }).strict(),
      output: z.object({ landed: z.boolean() }),
      description: 'Rebase a thread onto main.',
      tool: { name: 'test_thread_land' },
    }),
    internal: method({ input: z.void(), output: z.string() }),
    summary: method({
      input: z.void(),
      output: z.object({ threads: z.number() }),
      description: 'How many threads exist.',
      tool: { name: 'test_thread_summary', readOnly: true },
    }),
  },
})

const callers: ApiCaller[] = []

const ownerHost = defineHost({
  apis: [
    threads.host({
      status: ({ input, caller }) => {
        callers.push(caller)
        return { path: input.path ?? (caller.kind === 'agent' ? (caller.cwd ?? 'none') : 'none'), unlanded: 2 }
      },
      land: () => ({ landed: true }),
      internal: () => 'internal',
      summary: () => ({ threads: 3 }),
    }),
  ],
})

const plainApi = defineApi({ id: 'plain', version: 1, owner: '@test/caller', methods: { ping: method<void, string>() } })
const callerHost = defineHost({ apis: [plainApi.host({ ping: () => 'pong' })] })

const listingResponse = z.object({ result: z.object({ ok: z.literal(true), value: z.object({ output: z.custom<RegistryListing>() }) }) })

const agent = (cwd: string) => ({ id: 'session-1', session: { header: { cwd } } })

describe('API registry', () => {
  it('lets one Host plugin call another typed, in process, with the owner’s validation', async () => {
    const host = await createTestHost()
    callers.length = 0
    const caller = await host.mount(callerHost, { packageId: '@test/caller' })
    const client = createHostApiClient(caller.ctx, threads, '@test/caller')

    const missing = await client.safe.status({ path: '/repo' })
    expect(missing.ok).toBe(false)
    expect(!missing.ok && isApiOwnerMissing(missing.error)).toBe(true)
    expect(!missing.ok && missing.error.message).toBe('@test/threads is not loaded, so threads.status is unavailable.')
    expect(isApiServed(caller.ctx, threads)).toBe(false)

    const owner = await host.mount(ownerHost, { packageId: '@test/threads' })
    expect(isApiServed(caller.ctx, threads)).toBe(true)
    await expect(client.status({ path: '/repo' })).resolves.toEqual({ path: '/repo', unlanded: 2 })
    expect(callers).toEqual([{ kind: 'plugin', packageId: '@test/caller' }])
    await expect(client.status({ path: '' } as never)).rejects.toMatchObject({
      kind: 'contract',
      message: expect.stringContaining('path: Too small'),
    })

    await owner.dispose()
    await expect(client.status({ path: '/repo' })).rejects.toSatisfy(isApiOwnerMissing)
    await host.dispose()
  })

  it('exposes only opted-in methods as agent tools, through the native tool pipeline and its guards', async () => {
    const host = await createTestHost()
    callers.length = 0
    await host.mount(ownerHost, { packageId: '@test/threads' })
    const names = host.tools.schemas().map(schema => schema.name)
    expect(names).toEqual(expect.arrayContaining(['test_thread_status', 'test_thread_land', 'test_thread_summary', 'dshx_capabilities']))
    const summary = await host.tools.execute({ callId: 'call-0' as never, name: 'test_thread_summary', arguments: {}, signal: new AbortController().signal })
    expect(summary.content).toEqual([{ type: 'text', text: JSON.stringify({ threads: 3 }, null, 2) }])
    expect(names.some(name => name.includes('internal'))).toBe(false)
    expect(host.tools.schemas().find(schema => schema.name === 'test_thread_status')?.parameters).toEqual({
      type: 'object',
      properties: { path: { type: 'string' } },
      additionalProperties: false,
    })

    const status = await host.tools.execute({
      callId: 'call-1' as never,
      name: 'test_thread_status',
      arguments: {},
      agent: agent('/work/thread') as never,
      signal: new AbortController().signal,
    })
    expect(status.isError).toBe(false)
    expect(status.content).toEqual([{ type: 'text', text: 'status {"path":"/work/thread","unlanded":2}' }])
    expect(callers).toEqual([{ kind: 'agent', sessionId: 'session-1', cwd: '/work/thread' }])

    const invalid = await host.tools.execute({
      callId: 'call-2' as never,
      name: 'test_thread_land',
      arguments: { path: '' },
      signal: new AbortController().signal,
    })
    expect(invalid.isError).toBe(true)

    const land = vi.fn()
    host.ctx.on('tools/result', (execution, result) => {
      if (execution.name === 'test_thread_land') land(result.isError)
    })
    const release = host.tools.guard(execution => (execution.name === 'test_thread_land' ? 'Landing needs approval.' : undefined))
    const denied = await host.tools.execute({
      callId: 'call-3' as never,
      name: 'test_thread_land',
      arguments: { path: '/work/thread' },
      signal: new AbortController().signal,
    })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied.content)).toContain('Landing needs approval.')
    release()
    await host.dispose()
  })

  it('lists every served API, tool and skill through one Client endpoint and survives its server unloading', async () => {
    const host = await createTestHost()
    const first = await host.mount(callerHost, { packageId: '@test/caller' })
    await host.mount(ownerHost, { packageId: '@test/threads' })
    const list = async (): Promise<RegistryListing> => {
      const response = await host.connection.requestApi({
        packageId: dshxRegistryApi.owner!,
        apiId: dshxRegistryApi.id,
        method: 'list',
        version: 1,
        input: { schemas: true },
      })
      return listingResponse.parse(await response.json()).result.value.output
    }
    const listing = await list()
    const served = listing.apis.find(api => api.owner === '@test/threads')
    expect(served?.methods.map(entry => [entry.name, entry.tool ?? null])).toEqual([
      ['status', 'test_thread_status'],
      ['land', 'test_thread_land'],
      ['internal', null],
      ['summary', 'test_thread_summary'],
    ])
    expect(served?.methods[0]?.description).toBe('Revisions of a thread workspace not yet on main.')
    expect(served?.methods[0]?.input).toMatchObject({ type: 'object', properties: { path: { type: 'string', minLength: 1 } } })
    expect(listing.tools.find(tool => tool.name === 'test_thread_land')).toMatchObject({ source: 'api', owner: '@test/threads' })
    expect(listing.tools.find(tool => tool.name === 'dshx_capabilities')).toMatchObject({ source: 'tool' })
    expect(listing.skills).toEqual([])
    expect(listApis(first.ctx).map(api => `${api.owner}/${api.id}`)).toEqual([
      '@dshfiles/dshx/browser-traces',
      '@dshfiles/dshx/registry',
      '@dshfiles/dshx/storage',
      '@test/caller/plain',
      '@test/threads/threads',
    ])

    await first.dispose()
    const afterHandover = await list()
    expect(afterHandover.apis.map(api => api.owner)).toEqual(['@dshfiles/dshx', '@dshfiles/dshx', '@dshfiles/dshx', '@test/threads'])
    expect(host.tools.schemas().filter(schema => schema.name === 'dshx_capabilities')).toHaveLength(1)
    await host.dispose()
  })

  it('reports plugin tools and path-free skill provenance', async () => {
    const host = await createTestHost()
    const output = { schema: { description: 'text' }, render: () => [] }
    const toolHost = defineHost({
      tools: [
        {
          name: 'test_read',
          description: 'Read.',
          parameters: { type: 'object', properties: {} },
          output,
          isConcurrencySafe: () => true,
          execute: async () => 'ok',
        },
        { name: 'test_write', description: 'Write.', parameters: { type: 'object', properties: {} }, output, execute: async () => 'ok' },
      ],
    })
    await host.mount(toolHost, { packageId: '@test/tools' })
    host.ctx.provide('skills', {
      list: async () => [
        {
          name: 'verify',
          description: 'Verify.',
          provider: 'filesystem',
          source: 'project-agents',
          path: '/repo/.agents/skills/verify/SKILL.md',
          invocation: { modelInvocable: false, userInvocable: true },
        },
      ],
    })
    await host.mount(callerHost, { packageId: '@test/caller' })
    const response = await host.connection.requestApi({ packageId: dshxRegistryApi.owner!, apiId: dshxRegistryApi.id, method: 'list', version: 1, input: {} })
    const listing = listingResponse.parse(await response.json()).result.value.output
    expect(listing.tools.filter(tool => tool.name.startsWith('test_'))).toEqual([
      { name: 'test_read', description: 'Read.', source: 'plugin', owner: '@test/tools', readOnly: true, enabled: true },
      { name: 'test_write', description: 'Write.', source: 'plugin', owner: '@test/tools', readOnly: false, enabled: true },
    ])
    expect(listing.tools.find(tool => tool.name === 'dshx_capabilities')).toMatchObject({ source: 'tool', readOnly: true })
    expect(listing.skills).toEqual([
      {
        name: 'verify',
        description: 'Verify.',
        provider: 'filesystem',
        source: 'project-agents',
        modelInvocable: false,
        userInvocable: true,
      },
    ])
    await host.dispose()
  })

  it('registers a context-bound tool with plugin ownership and disposes it on unload', async () => {
    const host = await createTestHost()
    let factoryCalls = 0
    const definition = defineHost({
      inject: ['commands'],
      tools: [
        ctx => {
          factoryCalls += 1
          const commands = ctx.commands
          return {
            name: 'test_bound',
            description: 'Read the injected Host commands service.',
            parameters: { type: 'object', properties: {} },
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
            execute: async () => typeof commands.find,
          }
        },
      ],
    })
    expect(factoryCalls).toBe(0)
    const mounted = await host.mount(definition, { packageId: '@test/bound' })
    expect(factoryCalls).toBe(1)
    const result = await host.tools.execute({ callId: ToolCallId('bound-call'), name: 'test_bound', arguments: {}, signal: new AbortController().signal })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{ type: 'text', text: 'function' }])
    await host.mount(callerHost, { packageId: '@test/caller' })
    const list = async (): Promise<RegistryListing> => {
      const response = await host.connection.requestApi({ packageId: dshxRegistryApi.owner!, apiId: dshxRegistryApi.id, method: 'list', version: 1, input: {} })
      return listingResponse.parse(await response.json()).result.value.output
    }
    expect((await list()).tools.find(entry => entry.name === 'test_bound')).toMatchObject({ source: 'plugin', owner: '@test/bound' })
    await mounted.dispose()
    expect(host.tools.schemas().some(entry => entry.name === 'test_bound')).toBe(false)
    expect((await list()).tools.some(entry => entry.name === 'test_bound')).toBe(false)
    await host.dispose()
  })

  it('reports a Client call to an unloaded owner as owner-missing instead of a transport failure', async () => {
    const call = vi.fn(async () => {
      throw new Error('Connection request failed: HTTP 404')
    })
    const client = ApiRuntimeModel.createClient({ get: name => (name === 'connection' ? { rpc: { call } } : undefined) }, threads, '@test/caller')
    const result = await client.safe.status({})
    expect(!result.ok && isApiOwnerMissing(result.error)).toBe(true)
    expect(!result.ok && result.error.message).toBe('@test/threads is not loaded, so threads.status is unavailable.')
  })
})

describe('tool parameter projection', () => {
  it('keeps the enforced subset and loosens everything else', () => {
    const schema = z.object({
      name: z.string().min(1).describe('Thread name'),
      kind: z.enum(['a', 'b']).nullable(),
      tags: z.array(z.string()).max(3),
      when: z.union([z.string(), z.number()]).optional(),
    })
    expect(toToolSchema(publishedJsonSchema(schema, 'input'))).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Thread name' },
        kind: { type: 'string', enum: ['a', 'b'] },
        tags: { type: 'array', items: { type: 'string' } },
        when: {},
      },
      required: ['name', 'kind', 'tags'],
    })
  })

  it('keeps a discriminated union instead of collapsing the property to an empty schema', () => {
    const schema = z.object({
      action: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('describe'), message: z.string() }).strict(),
        z.object({ kind: z.literal('new'), commitId: z.string().optional() }).strict(),
      ]),
    })
    expect(toToolSchema(publishedJsonSchema(schema, 'input'))).toEqual({
      type: 'object',
      properties: {
        action: {
          oneOf: [
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'describe' }, message: { type: 'string' } },
              required: ['kind', 'message'],
              additionalProperties: false,
            },
            {
              type: 'object',
              properties: { kind: { type: 'string', const: 'new' }, commitId: { type: 'string' } },
              required: ['kind'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['action'],
    })
  })
})
