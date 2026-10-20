import { PassThrough } from 'node:stream'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { parseCliArgs } from '../src/cli/args.js'
import { runCli } from '../src/cli/run.js'
import { connectDshPlatformClient, createDshPlatformClientFromTransport, DshPlatformError } from '../src/platform/client.js'
import type { DshPlatformClient, DshPlatformTransport } from '../src/platform/client.js'
import type { CliIO } from '../src/cli/run.js'

const requestBodySchema = z.looseObject({
  rpcId: z.string().optional(),
  method: z.string(),
  payload: z.looseObject({ args: z.unknown().optional() }).optional(),
})

const decodeRequestBody = (body: BodyInit | null | undefined) => requestBodySchema.parse(JSON.parse(String(body)))

const decodeCliEnvelope = (text: string) => z.looseObject({ ok: z.boolean() }).parse(JSON.parse(text))

function io(): CliIO & {
  readonly out: PassThrough
  readonly err: PassThrough
} {
  const stdin = new PassThrough()
  const out = new PassThrough()
  const err = new PassThrough()
  return { stdin, stdout: out, stderr: err, out, err }
}

function capture(stream: PassThrough): () => string {
  let value = ''
  stream.on('data', chunk => {
    value += chunk.toString()
  })
  return () => value
}

function clientWith(rpc: DshPlatformTransport['rpc']): DshPlatformClient {
  return createDshPlatformClientFromTransport({
    rpc,
    sessionCursor: async () => 3,
  })
}

describe('DSH platform CLI', () => {
  it('parses platform command groups and scoped options', () => {
    expect(parseCliArgs(['sessions', 'history', 'session-1', '--max', '50', '--json'])).toMatchObject({
      command: 'sessions',
      platformArgs: ['history', 'session-1'],
      max: 50,
      json: true,
    })
    expect(parseCliArgs(['commands', 'run', '/help', '--session', 'session-1'])).toMatchObject({
      command: 'commands',
      platformArgs: ['run', '/help'],
      session: 'session-1',
    })
    expect(
      parseCliArgs(['runtime', 'add', 'server-a', 'Profile A', '--unit', 'dsh-a.service', '--remote-home', '/home/deploy/runtime-a', '--json']),
    ).toMatchObject({
      command: 'runtime',
      platformArgs: ['add', 'server-a', 'Profile A'],
      unit: 'dsh-a.service',
      remoteHome: '/home/deploy/runtime-a',
      json: true,
    })
    expect(parseCliArgs(['sessions', 'list', '--host', 'server-a', '--json'])).toMatchObject({
      command: 'sessions',
      platformArgs: ['list'],
      hostSelector: 'server-a',
      json: true,
    })
    expect(parseCliArgs(['workspace', 'open', 'runtime-a', '/srv/work'])).toMatchObject({
      command: 'workspace',
      platformArgs: ['open', 'runtime-a', '/srv/work'],
    })
    expect(() => parseCliArgs(['sessions', 'list', '--host', 'server-a', '--local'])).toThrow('--local is only valid with host add')
    expect(() => parseCliArgs(['commands', 'run', '/help'])).toThrow('--session')
    expect(() => parseCliArgs(['config', 'set', 'plugin', 'enabled', 'not-json'])).not.toThrow()
  })

  it('emits a stable JSON envelope without resolving a plugin project', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const projectReads = vi.fn()
    const client = clientWith(async (namespace, method) => {
      if (namespace === 'pluginManager' && method === 'listPlugins') {
        return [
          {
            entryId: 'plugin-entry',
            moduleName: '@sample/plugin',
            enabled: true,
            fiberPhase: 'active',
          },
        ]
      }
      throw new Error(`Unexpected RPC ${namespace}/${method}`)
    })
    const exitCode = await runCli(['plugins', 'list', '--json'], {
      io: streams,
      version: 'test-version',
      runtime: {
        connectPlatform: async () => client,
        resolveConfig: async () => {
          projectReads()
          throw new Error('plugin project lookup must be bypassed')
        },
      },
    })
    const result = JSON.parse(stdout())

    expect(exitCode).toBe(0)
    expect(projectReads).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      schemaVersion: 1,
      command: 'plugins list',
      ok: true,
      data: {
        items: [
          {
            id: 'plugin-entry',
            moduleName: '@sample/plugin',
            enabled: true,
            phase: 'active',
          },
        ],
      },
    })
  })

  it('shows action-specific help and keeps JSON output when quiet is set', async () => {
    const helpStreams = io()
    const help = capture(helpStreams.out)
    const helpExitCode = await runCli(['sessions', 'export', '--help'], {
      io: helpStreams,
      version: 'test-version',
    })

    expect(helpExitCode).toBe(0)
    expect(help()).toContain('USAGE dshx sessions export [OPTIONS] <SESSION-ID>')
    expect(help()).toContain('--output=<path>')

    const outputStreams = io()
    const output = capture(outputStreams.out)
    const client = clientWith(async (namespace, method) => {
      expect(namespace).toBe('pluginManager')
      expect(method).toBe('listPlugins')
      return []
    })
    const exitCode = await runCli(['plugins', 'list', '--json', '--quiet'], {
      io: outputStreams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })

    expect(exitCode).toBe(0)
    expect(decodeCliEnvelope(output())).toMatchObject({
      command: 'plugins list',
      ok: true,
      data: { items: [] },
    })
  })

  it('routes runtime management help through the platform CLI', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const exitCode = await runCli(['runtime', 'list', '--help'], { io: streams, version: 'test-version' })
    expect(exitCode).toBe(0)
    expect(stdout()).toContain('USAGE dshx runtime list [OPTIONS] [HOST-ID]')
  })

  it('runs static Slot explanation without resolving a plugin project', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const stderr = capture(streams.err)
    const resolveConfig = vi.fn()
    const exitCode = await runCli(['inspect', 'slots', '--explain'], {
      io: streams,
      version: 'test-version',
      runtime: {
        resolveConfig: async () => {
          resolveConfig()
          throw new Error('static Slot explanation must not resolve a plugin project')
        },
      },
    })

    expect(exitCode).toBe(0)
    expect(stdout()).toContain('sidebar.panellist')
    expect(stderr()).toContain('Pass --root <slot-name>')
    expect(resolveConfig).not.toHaveBeenCalled()
  })

  it('keeps launch tokens out of RPC URLs and forwards command cancellation signals', async () => {
    const calls: { readonly url: string; readonly init?: RequestInit }[] = []
    let archiveApiCallCount = 0
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      calls.push({ url, ...(init === undefined ? {} : { init }) })
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      if (url.includes('?token=')) {
        return new Response(null, {
          status: 302,
          headers: {
            'set-cookie': 'dsh.session=example-cookie; Path=/api; HttpOnly; SameSite=Lax',
          },
        })
      }
      const requestBody = z.object({ rpcId: z.string(), method: z.string() }).parse(decodeRequestBody(init?.body))
      return new Response(
        JSON.stringify({
          type: 'server-response',
          rpcId: requestBody.rpcId,
          result: {
            ok: true,
            value:
              requestBody.method === 'session/list'
                ? {
                    items: [
                      {
                        sessionId: 'session-1',
                        updatedAt: 10,
                        running: false,
                        blank: false,
                        agentAvailable: true,
                      },
                    ],
                  }
                : url.includes('/api/dshx-')
                  ? archiveApiCallCount++ === 0
                    ? {
                        version: 1,
                        output: {
                          apis: [
                            {
                              owner: '@dshfiles/thread-sidebar',
                              id: 'thread-sidebar-session-archive',
                              version: 1,
                              methods: [{ name: 'status' }],
                            },
                          ],
                        },
                      }
                    : { version: 1, output: { archivedSessionIds: ['session-1'] } }
                  : null,
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    })

    const client = await connectDshPlatformClient({
      url: 'http://127.0.0.1:3080/?token=synthetic-token',
      fetch: request,
    })
    expect(await client.sessions.list()).toMatchObject([{ sessionId: 'session-1', archived: true }])
    const controller = new AbortController()
    expect(await client.commands.execute('session-1', '/help', controller.signal)).toBeNull()
    const apiCall = calls[1]
    const commandCall = calls[4]
    const abortedCommand = new AbortController()
    abortedCommand.abort()
    await expect(client.commands.execute('session-1', '/help', abortedCommand.signal)).rejects.toMatchObject({ code: 'cancelled' })

    expect(calls).toHaveLength(6)
    expect(calls[0]?.url).toContain('synthetic-token')
    expect(calls[2]?.url).toMatch(/^http:\/\/127\.0\.0\.1:3080\/api\/dshx-[a-f0-9]+\/list$/u)
    expect(decodeRequestBody(calls[2]?.init?.body).method).toMatch(/^dshx-[a-f0-9]+\/list$/u)
    expect(calls[3]?.url).toMatch(/^http:\/\/127\.0\.0\.1:3080\/api\/dshx-[a-f0-9]+\/status$/u)
    expect(decodeRequestBody(calls[3]?.init?.body).method).toMatch(/^dshx-[a-f0-9]+\/status$/u)
    expect(decodeRequestBody(calls[3]?.init?.body).payload).toMatchObject({ version: 1, input: { sessionIds: ['session-1'] } })
    expect(apiCall?.url).toBe('http://127.0.0.1:3080/api/session/list')
    expect(new Headers(apiCall?.init?.headers).get('cookie')).toBe('dsh.session=example-cookie')
    expect(commandCall?.url).toBe('http://127.0.0.1:3080/api/commands/execute')
    expect(commandCall?.init?.signal).toBe(controller.signal)
    expect(decodeRequestBody(apiCall?.init?.body).payload?.args).toEqual({ _request: {} })
    expect(decodeRequestBody(commandCall?.init?.body).payload?.args).toEqual({ agentId: 'session-1', line: '/help', submittedAttachments: [] })
  })

  it('refuses non loopback launch URLs before making a request', async () => {
    const request = vi.fn<typeof fetch>()
    await expect(
      connectDshPlatformClient({
        url: 'http://example.com/?token=synthetic-token',
        fetch: request,
      }),
    ).rejects.toThrow('accepts only an HTTP launch URL on localhost')
    expect(request).not.toHaveBeenCalled()
  })

  it('shows archive state in the human-readable Session list', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const client = createDshPlatformClientFromTransport({
      sessionCursor: async () => 0,
      archivedSessionIds: async () => ['session-1'],
      rpc: async (namespace, method) => {
        if (namespace === 'session' && method === 'list')
          return {
            items: [
              {
                sessionId: 'session-1',
                updatedAt: 10,
                running: false,
                blank: false,
                agentAvailable: true,
              },
            ],
          }
        throw new Error(`Unexpected RPC ${namespace}/${method}`)
      },
    })

    const exitCode = await runCli(['sessions', 'list'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })

    expect(exitCode).toBe(0)
    expect(stdout()).toContain('ARCHIVED')
    expect(stdout()).toContain('yes')
  })

  it('preserves Host Session projections and command input descriptors', async () => {
    const client = createDshPlatformClientFromTransport({
      sessionCursor: async () => 0,
      archivedSessionIds: async () => ['session-1'],
      rpc: async (namespace, method) => {
        if (namespace === 'session' && method === 'list') {
          return {
            items: [
              {
                sessionId: 'session-1',
                updatedAt: 10,
                running: false,
                blank: false,
                agentAvailable: true,
                projections: { summary: 'Ready', state: 'idle' },
              },
            ],
          }
        }
        if (namespace === 'commands' && method === 'list') {
          return [
            {
              definitionId: 'command-1',
              name: 'review',
              description: 'Review current changes',
              input: { hint: 'Optional scope', attachments: true },
            },
          ]
        }
        throw new Error(`Unexpected RPC ${namespace}/${method}`)
      },
    })

    expect(await client.sessions.list()).toMatchObject([
      {
        sessionId: 'session-1',
        archived: true,
        projections: { summary: 'Ready', state: 'idle' },
      },
    ])
    expect(await client.commands.list('session-1')).toEqual([
      {
        definitionId: 'command-1',
        name: 'review',
        description: 'Review current changes',
        input: { hint: 'Optional scope', attachments: true },
      },
    ])
  })

  it('uses revisioned settings mutations and rejects non slash-prefixed Session commands', async () => {
    const calls: {
      readonly namespace: string
      readonly method: string
      readonly args: Parameters<DshPlatformTransport['rpc']>[2]
    }[] = []
    const client = clientWith(async (namespace, method, args) => {
      calls.push({ namespace, method, args })
      if (namespace === 'settings' && method === 'describe') {
        return {
          writable: true,
          hasDocument: true,
          namespaces: [
            {
              ns: 'plugin',
              schema: { type: 'object' },
              value: { enabled: false },
              autoGenerate: true,
              applies: 'live',
              secrets: [],
              revision: 7,
            },
          ],
        }
      }
      return { accepted: true }
    })
    const settings = await client.config.describe()
    await client.config.mutate('plugin', ['enabled'], true, settings.namespaces[0]?.revision ?? 0)

    expect(calls[1]).toMatchObject({
      namespace: 'settings',
      method: 'mutate',
      args: { ns: 'plugin', ops: [{ op: 'set', path: ['enabled'], value: true }], expectedRevision: 7 },
    })
    await expect(client.commands.execute('session-1', 'help')).rejects.toThrow('must start with /')
  })

  it('exports multiple Session history pages in ascending event order', async () => {
    const beforeSeqs: (number | undefined)[] = []
    const client = createDshPlatformClientFromTransport({
      sessionCursor: async () => 4,
      rpc: async (namespace, method, args) => {
        expect(namespace).toBe('session')
        expect(method).toBe('page')
        const request = z.object({ beforeSeq: z.number().optional() }).parse(args.request)
        beforeSeqs.push(request.beforeSeq)
        if (request.beforeSeq === undefined) {
          return {
            records: [
              { type: 'event', event: { seq: 3 } },
              { type: 'event', event: { seq: 4 } },
            ],
            hasMore: true,
          }
        }
        return {
          records: [
            { type: 'event', event: { seq: 1 } },
            { type: 'event', event: { seq: 2 } },
          ],
          hasMore: false,
        }
      },
    })

    const records = await client.sessions.export('session-1')

    expect(records.map(record => z.object({ type: z.string(), event: z.object({ seq: z.number() }) }).parse(record).event.seq)).toEqual([1, 2, 3, 4])
    expect(beforeSeqs).toEqual([undefined, 3])
  })

  it('reports profile-wide plugin mutation and restart requirements in JSON', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const client = clientWith(async (namespace, method, args) => {
      expect(namespace).toBe('pluginManager')
      expect(method).toBe('setPluginEnabled')
      expect(args).toEqual({ id: 'entry-1', enabled: true })
      return {
        application: 'restart-required',
        changed: true,
        enabled: true,
        stage: 'enable',
        target: 'entry-1',
        warnings: ['DSH restart required'],
      }
    })

    const exitCode = await runCli(['plugins', 'enable', 'entry-1', '--json'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })

    expect(exitCode).toBe(0)
    expect(decodeCliEnvelope(stdout())).toMatchObject({
      ok: true,
      data: {
        scope: 'connected-host-profile',
        application: 'restart-required',
        restartRequired: true,
        enabled: true,
      },
    })
  })

  it('returns the standard interrupt exit code for a cancelled Session command', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const client = clientWith(async (namespace, method) => {
      expect(namespace).toBe('commands')
      expect(method).toBe('execute')
      throw new DshPlatformError('cancelled', 'DSH command request was cancelled by the caller.')
    })
    const exitCode = await runCli(['commands', 'run', '/help', '--session', 'session-1', '--json'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })

    expect(exitCode).toBe(130)
    expect(decodeCliEnvelope(stdout())).toMatchObject({
      ok: false,
      error: { code: 'cancelled' },
    })
  })

  it('keeps settings secrets redacted and refuses secret values passed on the command line', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const calls: string[] = []
    const client = clientWith(async (namespace, method) => {
      calls.push(`${namespace}/${method}`)
      if (namespace === 'settings' && method === 'describe') {
        return {
          writable: true,
          hasDocument: true,
          namespaces: [
            {
              ns: 'plugin',
              schema: { type: 'object' },
              value: { credentials: {} },
              autoGenerate: true,
              applies: 'live',
              secrets: [{ path: ['credentials', 'apiKey'], set: true }],
              revision: 8,
            },
          ],
        }
      }
      throw new Error(`Unexpected RPC ${namespace}/${method}`)
    })

    const getExitCode = await runCli(['config', 'get', 'plugin', 'credentials.apiKey', '--json'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    const getResult = JSON.parse(stdout())

    expect(getExitCode).toBe(0)
    expect(getResult).toMatchObject({
      data: { redacted: true, configured: true, value: null },
    })

    const setStreams = io()
    const setOutput = capture(setStreams.out)
    const setExitCode = await runCli(['config', 'set', 'plugin', 'credentials.apiKey', '"never-echo-this"', '--json'], {
      io: setStreams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    const setResult = JSON.parse(setOutput())

    expect(setExitCode).toBe(1)
    expect(setResult).toMatchObject({
      ok: false,
      error: { code: 'secret-input-unsupported' },
    })
    expect(setOutput()).not.toContain('never-echo-this')
    expect(calls).toEqual(['settings/describe', 'settings/describe'])
  })

  it('emits JSON usage errors for malformed platform commands', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const exitCode = await runCli(['plugins', 'whoops', '--json'], {
      io: streams,
      version: 'test-version',
    })

    expect(exitCode).toBe(2)
    expect(decodeCliEnvelope(stdout())).toMatchObject({
      schemaVersion: 1,
      command: 'plugins',
      ok: false,
      error: { code: 'usage' },
    })
  })

  it('parses the DSH-native session, bundle, model, preset, and skill commands', () => {
    expect(parseCliArgs(['sessions', 'prompt', 'session-1', 'review', 'this', '--mode', 'steer'])).toMatchObject({
      command: 'sessions',
      platformArgs: ['prompt', 'session-1', 'review', 'this'],
      mode: 'steer',
    })
    expect(parseCliArgs(['bundles', 'install', '@sample/bundle'])).toMatchObject({
      command: 'bundles',
      platformArgs: ['install', '@sample/bundle'],
    })
    expect(parseCliArgs(['models', 'select', '--session', 'session-1', 'deepseek', 'reasoner', '--reasoning-effort', 'high'])).toMatchObject({
      command: 'models',
      platformArgs: ['select', 'deepseek', 'reasoner'],
      session: 'session-1',
      reasoningEffort: 'high',
    })
    expect(parseCliArgs(['skills', 'list', '--session', 'session-1'])).toMatchObject({
      command: 'skills',
      platformArgs: ['list'],
      session: 'session-1',
    })
    expect(parseCliArgs(['plugins', 'check', '@sample/plugin'])).toMatchObject({
      command: 'plugins',
      platformArgs: ['check', '@sample/plugin'],
    })
    expect(() => parseCliArgs(['sessions', 'prompt', 'session-1'])).toThrow('requires message text')
    expect(() => parseCliArgs(['models', 'select', 'deepseek', 'reasoner'])).toThrow('--session')
    expect(() => parseCliArgs(['models', 'list', '--session', 'session-1'])).toThrow('models select')
    expect(() => parseCliArgs(['plugins', 'check'])).toThrow('a package spec')
  })

  it('maps expanded DSH Remote contracts through the reusable typed client', async () => {
    const calls: {
      readonly namespace: string
      readonly method: string
      readonly args: Parameters<DshPlatformTransport['rpc']>[2]
    }[] = []
    const client = clientWith(async (namespace, method, args) => {
      calls.push({ namespace, method, args })
      if (namespace === 'session' && method === 'search')
        return {
          items: [{ sessionId: 'session-1', snippet: 'synthetic match' }],
          hasMore: false,
        }
      if (namespace === 'session' && method === 'rename') return { title: 'Renamed', seq: 7 }
      if (namespace === 'workspace' && ['archiveSession', 'unarchiveSession'].includes(method)) return { archivedSessionIds: ['session-1'] }
      if (namespace === 'session' && method === 'prompt') return { accepted: true }
      if (namespace === 'pluginManager' && method === 'inspect')
        return {
          status: 'accepted',
          kind: 'registry',
          name: '@sample/bundle',
          version: '1.0.0',
          bundle: true,
          registry: null,
        }
      if (namespace === 'pluginManager' && ['installBundle', 'removeBundle'].includes(method))
        return {
          application: 'applied',
          changed: true,
          stage: method === 'installBundle' ? 'install' : 'remove',
          target: '@sample/bundle',
          enabled: true,
        }
      if (namespace === 'agentPresets' && method === 'list')
        return {
          presets: [{ id: 'standard', isDefault: true, name: 'Standard' }],
        }
      if (namespace === 'agentPresets' && method === 'read')
        return {
          agentPreset: 'standard',
          name: 'Standard',
          content: '- id: @deepseek-ai/dsh-agent',
        }
      if (namespace === 'session' && method === 'modelCatalog')
        return {
          default: { provider: 'deepseek', model: 'reasoner' },
          routableProviders: ['deepseek'],
          groups: [
            {
              id: 'deepseek',
              name: 'DeepSeek',
              models: [{ id: 'reasoner', name: 'Reasoner' }],
            },
          ],
          failures: [],
        }
      if (namespace === 'session' && method === 'selectModel')
        return {
          selected: {
            provider: 'deepseek',
            model: 'reasoner',
            reasoningEffort: 'high',
          },
        }
      if (namespace === 'skills' && method === 'list')
        return {
          skills: [
            {
              name: 'review',
              description: 'Review code',
              modelInvocable: true,
            },
          ],
        }
      throw new Error(`Unexpected RPC ${namespace}/${method}`)
    })

    expect(await client.sessions.search('synthetic match')).toEqual({
      items: [{ sessionId: 'session-1', snippet: 'synthetic match' }],
      hasMore: false,
    })
    expect(await client.sessions.rename('session-1', 'Renamed')).toEqual({
      title: 'Renamed',
      seq: 7,
    })
    expect(await client.sessions.archive('session-1')).toEqual({
      archivedSessionIds: ['session-1'],
    })
    expect(await client.sessions.unarchive('session-1')).toEqual({
      archivedSessionIds: ['session-1'],
    })
    expect(await client.sessions.prompt('session-1', 'synthetic prompt', 'queue')).toEqual({ accepted: true })
    expect(await client.plugins.check('@sample/bundle')).toMatchObject({
      status: 'accepted',
      bundle: true,
    })
    expect(await client.bundles.install('@sample/bundle')).toMatchObject({
      stage: 'install',
      application: 'applied',
    })
    expect(await client.bundles.remove('@sample/bundle')).toMatchObject({
      stage: 'remove',
      application: 'applied',
    })
    expect(await client.presets.list()).toMatchObject([{ id: 'standard', isDefault: true }])
    expect(await client.presets.show('standard')).toMatchObject({
      agentPreset: 'standard',
      content: '- id: @deepseek-ai/dsh-agent',
    })
    expect(await client.models.list()).toMatchObject({
      default: { provider: 'deepseek' },
      groups: [{ id: 'deepseek' }],
    })
    expect(
      await client.models.select('session-1', {
        provider: 'deepseek',
        model: 'reasoner',
        reasoningEffort: 'high',
      }),
    ).toEqual({
      provider: 'deepseek',
      model: 'reasoner',
      reasoningEffort: 'high',
    })
    expect(await client.skills.list('session-1')).toEqual([{ name: 'review', description: 'Review code', modelInvocable: true }])
    expect(calls.map(call => `${call.namespace}/${call.method}`)).toEqual([
      'session/search',
      'session/rename',
      'workspace/archiveSession',
      'workspace/unarchiveSession',
      'session/prompt',
      'pluginManager/inspect',
      'pluginManager/installBundle',
      'pluginManager/removeBundle',
      'agentPresets/list',
      'agentPresets/read',
      'session/modelCatalog',
      'session/selectModel',
      'skills/list',
    ])
    expect(calls[2]?.args).toEqual({ request: { sessionId: 'session-1' } })
    expect(calls[3]?.args).toEqual({ request: { sessionId: 'session-1' } })
    expect(calls[4]?.args.request).toMatchObject({
      sessionId: 'session-1',
      mode: 'queue',
      content: [{ type: 'text', text: 'synthetic prompt' }],
    })
  })

  it('cancels a DSH bundle install through the matching manager request id', async () => {
    const calls: {
      readonly namespace: string
      readonly method: string
      readonly args: Parameters<DshPlatformTransport['rpc']>[2]
    }[] = []
    let resolveInstall: ((result: unknown) => void) | undefined
    const client = clientWith(async (namespace, method, args) => {
      calls.push({ namespace, method, args })
      if (namespace === 'pluginManager' && method === 'installBundle')
        return new Promise(resolve => {
          resolveInstall = resolve
        })
      if (namespace === 'pluginManager' && method === 'cancelInstall') return { status: 'cancelled' }
      throw new Error(`Unexpected RPC ${namespace}/${method}`)
    })
    const controller = new AbortController()
    const installation = client.bundles.install('@sample/bundle', controller.signal)
    expect(resolveInstall).toBeDefined()
    controller.abort()
    resolveInstall?.({
      application: 'cancelled',
      changed: false,
      stage: 'install',
      target: '@sample/bundle',
    })

    await expect(installation).rejects.toMatchObject({ code: 'cancelled' })
    const requestId = z.object({ requestId: z.string() }).parse(calls[0]?.args.options).requestId
    expect(calls[0]).toMatchObject({
      namespace: 'pluginManager',
      method: 'installBundle',
      args: { spec: '@sample/bundle', options: { requestId } },
    })
    expect(calls[1]).toMatchObject({
      namespace: 'pluginManager',
      method: 'cancelInstall',
      args: { requestId },
    })
  })

  it('sends Session prompts without echoing their text in JSON output', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const calls: {
      readonly namespace: string
      readonly method: string
      readonly args: Parameters<DshPlatformTransport['rpc']>[2]
    }[] = []
    const client = clientWith(async (namespace, method, args) => {
      calls.push({ namespace, method, args })
      if (namespace === 'session' && method === 'prompt') return { accepted: true }
      throw new Error(`Unexpected RPC ${namespace}/${method}`)
    })
    const exitCode = await runCli(['sessions', 'prompt', 'session-1', 'secret-like synthetic message', '--json'], {
      io: streams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    const output = stdout()

    expect(exitCode).toBe(0)
    expect(decodeCliEnvelope(output)).toMatchObject({
      ok: true,
      data: { sessionId: 'session-1', mode: 'queue', accepted: true },
    })
    expect(output).not.toContain('secret-like synthetic message')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      namespace: 'session',
      method: 'prompt',
      args: {
        request: {
          sessionId: 'session-1',
          content: [{ type: 'text', text: 'secret-like synthetic message' }],
        },
      },
    })
  })
})
