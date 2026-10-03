import { PassThrough } from 'node:stream'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { parseCliArgs } from '../src/cli/args.js'
import { runCli } from '../src/cli/run.js'
import { connectDshPlatformClient, createDshPlatformClientFromTransport, DshPlatformError } from '../src/platform/client.js'
import type { DshPlatformClient, DshPlatformTransport } from '../src/platform/client.js'
import type { CliIO } from '../src/cli/run.js'

function io(): CliIO & { readonly out: PassThrough; readonly err: PassThrough } {
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
  return createDshPlatformClientFromTransport({ rpc, sessionCursor: async () => 3 })
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
    expect(() => parseCliArgs(['commands', 'run', '/help'])).toThrow('--session')
    expect(() => parseCliArgs(['config', 'set', 'plugin', 'enabled', 'not-json'])).not.toThrow()
  })

  it('emits a stable JSON envelope without resolving a plugin project', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const projectReads = vi.fn()
    const client = clientWith(async (namespace, method) => {
      if (namespace === 'pluginManager' && method === 'listPlugins') {
        return [{ entryId: 'plugin-entry', moduleName: '@sample/plugin', enabled: true, fiberPhase: 'active' }]
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
      data: { items: [{ id: 'plugin-entry', moduleName: '@sample/plugin', enabled: true, phase: 'active' }] },
    })
  })

  it('shows action-specific help and keeps JSON output when quiet is set', async () => {
    const helpStreams = io()
    const help = capture(helpStreams.out)
    const helpExitCode = await runCli(['sessions', 'export', '--help'], { io: helpStreams, version: 'test-version' })

    expect(helpExitCode).toBe(0)
    expect(help()).toContain('Usage: dshx sessions export <session-id> [--output <path>]')

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
    expect(JSON.parse(output())).toMatchObject({ command: 'plugins list', ok: true, data: { items: [] } })
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
    const request = vi.fn<typeof fetch>(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      calls.push({ url, ...(init === undefined ? {} : { init }) })
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
      if (url.includes('?token=')) {
        return new Response(null, { status: 302, headers: { 'set-cookie': 'dsh.session=example-cookie; Path=/api; HttpOnly; SameSite=Lax' } })
      }
      const body = JSON.parse(String(init?.body))
      const requestBody = z.object({ rpcId: z.string(), method: z.string() }).parse(body)
      return new Response(
        JSON.stringify({
          type: 'server-response',
          rpcId: requestBody.rpcId,
          result: { ok: true, value: requestBody.method === 'session/list' ? { items: [] } : null },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    })

    const client = await connectDshPlatformClient({ url: 'http://127.0.0.1:3080/?token=synthetic-token', fetch: request })
    expect(await client.sessions.list()).toEqual([])
    const controller = new AbortController()
    expect(await client.commands.execute('session-1', '/help', controller.signal)).toBeNull()
    const apiCall = calls[1]
    const commandCall = calls[2]
    const abortedCommand = new AbortController()
    abortedCommand.abort()
    await expect(client.commands.execute('session-1', '/help', abortedCommand.signal)).rejects.toMatchObject({ code: 'cancelled' })

    expect(calls).toHaveLength(4)
    expect(calls[0]?.url).toContain('synthetic-token')
    expect(apiCall?.url).toBe('http://127.0.0.1:3080/api/session/list')
    expect(new Headers(apiCall?.init?.headers).get('cookie')).toBe('dsh.session=example-cookie')
    expect(commandCall?.url).toBe('http://127.0.0.1:3080/api/commands/execute')
    expect(commandCall?.init?.signal).toBe(controller.signal)
  })

  it('refuses non loopback launch URLs before making a request', async () => {
    const request = vi.fn<typeof fetch>()
    await expect(connectDshPlatformClient({ url: 'http://example.com/?token=synthetic-token', fetch: request })).rejects.toThrow(
      'accepts only an HTTP launch URL on localhost',
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('preserves Host Session projections and command input descriptors', async () => {
    const client = createDshPlatformClientFromTransport({
      sessionCursor: async () => 0,
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
          return [{ definitionId: 'command-1', name: 'review', description: 'Review current changes', input: { hint: 'Optional scope', attachments: true } }]
        }
        throw new Error(`Unexpected RPC ${namespace}/${method}`)
      },
    })

    expect(await client.sessions.list()).toMatchObject([{ sessionId: 'session-1', projections: { summary: 'Ready', state: 'idle' } }])
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
    const calls: { readonly namespace: string; readonly method: string; readonly args: readonly unknown[] }[] = []
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
      args: ['plugin', [{ op: 'set', path: ['enabled'], value: true }], 7],
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
        const request = z.object({ beforeSeq: z.number().optional() }).parse(args[0])
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
      expect(args).toEqual(['entry-1', true])
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
    expect(JSON.parse(stdout())).toMatchObject({
      ok: true,
      data: { scope: 'connected-host-profile', application: 'restart-required', restartRequired: true, enabled: true },
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
    expect(JSON.parse(stdout())).toMatchObject({ ok: false, error: { code: 'cancelled' } })
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
    expect(getResult).toMatchObject({ data: { redacted: true, configured: true, value: null } })

    const setStreams = io()
    const setOutput = capture(setStreams.out)
    const setExitCode = await runCli(['config', 'set', 'plugin', 'credentials.apiKey', '"never-echo-this"', '--json'], {
      io: setStreams,
      version: 'test-version',
      runtime: { connectPlatform: async () => client },
    })
    const setResult = JSON.parse(setOutput())

    expect(setExitCode).toBe(1)
    expect(setResult).toMatchObject({ ok: false, error: { code: 'secret-input-unsupported' } })
    expect(setOutput()).not.toContain('never-echo-this')
    expect(calls).toEqual(['settings/describe', 'settings/describe'])
  })

  it('emits JSON usage errors for malformed platform commands', async () => {
    const streams = io()
    const stdout = capture(streams.out)
    const exitCode = await runCli(['plugins', 'whoops', '--json'], { io: streams, version: 'test-version' })

    expect(exitCode).toBe(2)
    expect(JSON.parse(stdout())).toMatchObject({
      schemaVersion: 1,
      command: 'plugins',
      ok: false,
      error: { code: 'usage' },
    })
  })
})
