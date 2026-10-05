import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { parseCliArgs } from '../src/cli/args.js'
import { runPlatformCli } from '../src/cli/platform.js'
import type { PlatformCliRuntime } from '../src/cli/platform.js'
import { connectDshPlatformClient, createDshPlatformClientFromTransport, DshPlatformError } from '../src/platform/client.js'
import type { DshPlatformClient, DshPlatformTransport } from '../src/platform/client.js'

const capturedIO = () => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let out = ''
  let err = ''
  stdout.on('data', chunk => {
    out += String(chunk)
  })
  stderr.on('data', chunk => {
    err += String(chunk)
  })
  return { io: { stdout, stderr }, read: () => ({ stdout: out, stderr: err }) }
}

const clientWith = ({ rpc }: { readonly rpc: DshPlatformTransport['rpc'] }): DshPlatformClient =>
  createDshPlatformClientFromTransport({ rpc, sessionCursor: async () => 0 })

const run = async ({
  argv,
  client,
  connect,
  readDshVersion = async () => 'dsh 0.2.0-rc.2',
}: {
  readonly argv: readonly string[]
  readonly client?: DshPlatformClient
  readonly connect?: PlatformCliRuntime['connect']
  readonly readDshVersion?: () => Promise<string | undefined>
}) => {
  const captured = capturedIO()
  const runtime: PlatformCliRuntime = {
    io: captured.io,
    dshxVersion: 'test-version',
    readDshVersion,
    connect: connect ?? (async () => client ?? clientWith({ rpc: async () => null })),
  }
  const code = await runPlatformCli(parseCliArgs([...argv]), runtime)
  return { code, ...captured.read() }
}

const envelopeSchema = z.object({ ok: z.boolean(), data: z.unknown().optional(), error: z.object({ code: z.string(), message: z.string() }).optional() })

const doctorDataSchema = z.object({
  dshCliVersion: z.string().nullable(),
  checks: z.array(z.object({ id: z.string(), status: z.enum(['pass', 'fail', 'unknown']), detail: z.string() })),
})

const doctorChecks = (stdout: string) => doctorDataSchema.parse(envelopeSchema.parse(JSON.parse(stdout)).data).checks

const bundleRow = (overrides: { readonly name?: string; readonly installed?: boolean; readonly error?: { readonly code: string } } = {}) => ({
  name: '@sample/bundle',
  enabled: true,
  installed: true,
  optional: false,
  removable: true,
  rows: [],
  overrides: [],
  ...overrides,
})

const pluginRow = (overrides: { readonly entryId?: string; readonly moduleName?: string; readonly fiberPhase?: string } = {}) => ({
  entryId: 'sample-entry',
  moduleName: '@sample/plugin',
  enabled: true,
  fiberPhase: 'active',
  ...overrides,
})

const settingsDescription = ({ writable = true }: { readonly writable?: boolean } = {}) => ({
  writable,
  hasDocument: true,
  namespaces: [
    {
      ns: 'plugin',
      schema: { type: 'object' },
      value: { enabled: false, servers: [{ name: 'alpha' }] },
      autoGenerate: true,
      applies: 'live',
      secrets: [],
      revision: 3,
    },
  ],
})

const inventoryRpc =
  ({
    plugins = [pluginRow()],
    bundles = [bundleRow()],
    failing = [],
  }: {
    readonly plugins?: readonly unknown[]
    readonly bundles?: readonly unknown[]
    readonly failing?: readonly string[]
  } = {}): DshPlatformTransport['rpc'] =>
  async (namespace, method) => {
    const name = `${namespace}/${method}`
    if (failing.includes(name)) throw new DshPlatformError('rpc-http-error', `${name} failed`)
    if (name === 'session/list') return { items: [] }
    if (name === 'pluginManager/listPlugins') return plugins
    if (name === 'pluginManager/listBundles') return bundles
    if (name === 'settings/describe') return settingsDescription()
    throw new Error(`Unexpected RPC ${name}`)
  }

describe('dshx doctor', () => {
  it('passes when every DSH API probe answers with a healthy inventory', async () => {
    const result = await run({ argv: ['doctor', '--json'], client: clientWith({ rpc: inventoryRpc() }) })

    expect(result.code).toBe(0)
    expect(doctorChecks(result.stdout)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'dsh-cli', status: 'pass', detail: 'dsh 0.2.0-rc.2' }),
        expect.objectContaining({ id: 'host-rpc', status: 'pass' }),
        expect.objectContaining({ id: 'plugins', status: 'pass' }),
        expect.objectContaining({ id: 'bundles', status: 'pass' }),
        expect.objectContaining({ id: 'settings', status: 'pass' }),
      ]),
    )
  })

  it('fails on failed entries, duplicate module names, broken bundles, and rejected probes', async () => {
    const rpc = inventoryRpc({
      plugins: [
        pluginRow(),
        pluginRow({ entryId: 'duplicate-entry' }),
        pluginRow({ entryId: 'broken-entry', moduleName: '@sample/broken', fiberPhase: 'failed' }),
      ],
      bundles: [bundleRow({ name: '@sample/errored', error: { code: 'install-failed' } }), bundleRow({ name: '@sample/missing', installed: false })],
      failing: ['settings/describe'],
    })
    const result = await run({ argv: ['doctor', '--json'], client: clientWith({ rpc }), readDshVersion: async () => undefined })
    const checks = doctorChecks(result.stdout)

    expect(result.code).toBe(1)
    expect(checks.find(check => check.id === 'dsh-cli')).toMatchObject({ status: 'unknown' })
    expect(checks.find(check => check.id === 'host-rpc')).toMatchObject({ status: 'fail', detail: '1 DSH API probes failed.' })
    expect(checks.find(check => check.id === 'plugins')?.detail).toBe(
      '3 plugin entries; 1 failed or broken entries: broken-entry; duplicate module names: @sample/plugin',
    )
    expect(checks.find(check => check.id === 'bundles')).toMatchObject({ status: 'fail', detail: expect.stringContaining('@sample/errored, @sample/missing') })
    expect(checks.some(check => check.id === 'settings')).toBe(false)
  })

  it('reports an unreachable Host without leaking the launch token', async () => {
    const result = await run({
      argv: ['doctor', '--json'],
      connect: async () => {
        throw new DshPlatformError('connection-failed', 'Could not reach http://127.0.0.1:3080/?token=launch-secret')
      },
    })
    const checks = doctorChecks(result.stdout)

    expect(result.code).toBe(1)
    expect(checks.find(check => check.id === 'host-rpc')).toMatchObject({ status: 'fail', detail: 'Could not reach http://127.0.0.1:3080/?token=[redacted]' })
    expect(result.stdout).not.toContain('launch-secret')
  })
})

describe('dshx status', () => {
  it('counts sessions, plugins, and bundles', async () => {
    const result = await run({ argv: ['status', '--json'], client: clientWith({ rpc: inventoryRpc() }) })

    expect(result.code).toBe(0)
    expect(envelopeSchema.parse(JSON.parse(result.stdout)).data).toMatchObject({ connected: true, sessions: 0, plugins: 1, bundles: 1 })
  })

  it.each([
    ['not-found', 4],
    ['cancelled', 130],
    ['rpc-http-error', 1],
  ])('maps a %s failure to exit code %i', async (code, exitCode) => {
    const rpc: DshPlatformTransport['rpc'] = async () => {
      throw new DshPlatformError(code, 'probe failed')
    }
    const result = await run({ argv: ['status'], client: clientWith({ rpc }) })

    expect(result.code).toBe(exitCode)
    expect(result.stderr).toBe(`error [${code}]: probe failed\n`)
  })

  it('reports a Host response outside the API contract as invalid-response', async () => {
    const rpc = inventoryRpc({ plugins: [{ entryId: 7, moduleName: '@sample/plugin' }] })
    const result = await run({ argv: ['plugins', 'list', '--json'], client: clientWith({ rpc }) })
    const envelope = envelopeSchema.parse(JSON.parse(result.stdout))

    expect(result.code).toBe(1)
    expect(envelope.error).toMatchObject({ code: 'invalid-response', message: expect.stringContaining('DSH returned data outside its API contract') })
    expect(envelope.error?.message).toContain('entryId')
  })
})

describe('dshx config get/set', () => {
  const settingsRpc = ({ writable = true }: { readonly writable?: boolean } = {}) => {
    const mutate = vi.fn()
    const rpc: DshPlatformTransport['rpc'] = async (namespace, method, args) => {
      if (namespace === 'settings' && method === 'describe') return settingsDescription({ writable })
      if (namespace === 'settings' && method === 'mutate') {
        mutate(args)
        return null
      }
      throw new Error(`Unexpected RPC ${namespace}/${method}`)
    }
    return { client: clientWith({ rpc }), mutate }
  }

  it('reads nested values through array indexes', async () => {
    const result = await run({ argv: ['config', 'get', 'plugin', 'servers.0.name', '--json'], client: settingsRpc().client })

    expect(result.code).toBe(0)
    expect(envelopeSchema.parse(JSON.parse(result.stdout)).data).toEqual({ namespace: 'plugin', path: 'servers.0.name', revision: 3, value: 'alpha' })
  })

  it.each([
    ['a missing key', 'servers.0.port', 'not-found', 4],
    ['a non-numeric array index', 'servers.first', 'not-found', 4],
    ['an empty path segment', 'servers..name', 'invalid-path', 1],
  ])('rejects %s', async (_label, path, code, exitCode) => {
    const result = await run({ argv: ['config', 'get', 'plugin', path, '--json'], client: settingsRpc().client })

    expect(result.code).toBe(exitCode)
    expect(envelopeSchema.parse(JSON.parse(result.stdout)).error).toMatchObject({ code })
  })

  it('rejects an unknown namespace', async () => {
    const result = await run({ argv: ['config', 'get', 'missing', '--json'], client: settingsRpc().client })

    expect(result.code).toBe(4)
    expect(envelopeSchema.parse(JSON.parse(result.stdout)).error).toMatchObject({ code: 'not-found' })
  })

  it('refuses a value that is not JSON before mutating anything', async () => {
    const settings = settingsRpc()
    const result = await run({ argv: ['config', 'set', 'plugin', 'enabled', 'not-json', '--json'], client: settings.client })

    expect(result.code).toBe(1)
    expect(envelopeSchema.parse(JSON.parse(result.stdout)).error).toMatchObject({ code: 'invalid-json-value' })
    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it('refuses writes when DSH reports the configuration read-only', async () => {
    const settings = settingsRpc({ writable: false })
    const result = await run({ argv: ['config', 'set', 'plugin', 'enabled', 'true', '--json'], client: settings.client })

    expect(result.code).toBe(1)
    expect(envelopeSchema.parse(JSON.parse(result.stdout)).error).toMatchObject({ code: 'read-only' })
    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it('sets and unsets one path at the current revision', async () => {
    const settings = settingsRpc()
    const set = await run({ argv: ['config', 'set', 'plugin', 'enabled', 'true', '--json'], client: settings.client })
    const unset = await run({ argv: ['config', 'unset', 'plugin', 'servers', '--json'], client: settings.client })

    expect(set.code).toBe(0)
    expect(unset.code).toBe(0)
    expect(settings.mutate.mock.calls).toEqual([
      [{ ns: 'plugin', ops: [{ op: 'set', path: ['enabled'], value: true }], expectedRevision: 3 }],
      [{ ns: 'plugin', ops: [{ op: 'unset', path: ['servers'] }], expectedRevision: 3 }],
    ])
  })
})

describe('connectDshPlatformClient', () => {
  const launchUrl = 'http://127.0.0.1:3080/?token=synthetic-token'
  const authenticated = () => new Response(null, { status: 302, headers: { 'set-cookie': 'dsh.session=cookie; Path=/; HttpOnly' } })
  const rpcRequestSchema = z.object({ rpcId: z.string() })

  const connectWith = ({ api }: { readonly api: (rpcId: string) => Response }) =>
    connectDshPlatformClient({
      url: launchUrl,
      fetch: async (input, init) => {
        if (String(input).includes('?token=')) return authenticated()
        return api(rpcRequestSchema.parse(JSON.parse(String(init?.body))).rpcId)
      },
    })

  it.each([
    ['an unparsable URL', 'not a url', 'invalid-url'],
    ['a URL without a token', 'http://127.0.0.1:3080/', 'invalid-url'],
    ['a launch URL with a non-root path', 'http://127.0.0.1:3080/app?token=abc', 'invalid-url'],
    ['an HTTPS URL', 'https://127.0.0.1:3080/?token=abc', 'unsafe-url'],
    ['credentials in the URL', 'http://user:pass@localhost:3080/?token=abc', 'unsafe-url'],
  ])('rejects %s before any request', async (_label, url, code) => {
    const request = vi.fn<typeof fetch>()
    await expect(connectDshPlatformClient({ url, fetch: request })).rejects.toMatchObject({ code })
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a launch exchange that is refused or sets no session cookie', async () => {
    await expect(connectDshPlatformClient({ url: launchUrl, fetch: async () => new Response(null, { status: 401 }) })).rejects.toMatchObject({
      code: 'authentication-failed',
      message: expect.stringContaining('rejected the launch URL'),
    })
    await expect(connectDshPlatformClient({ url: launchUrl, fetch: async () => new Response(null, { status: 302 }) })).rejects.toMatchObject({
      code: 'authentication-failed',
      message: expect.stringContaining('session cookie'),
    })
  })

  it.each([
    ['an expired session', () => new Response(null, { status: 401 }), 'authentication-expired'],
    ['an HTTP failure', () => new Response(null, { status: 500 }), 'rpc-http-error'],
    ['a non-JSON body', () => new Response('<html>', { status: 200 }), 'invalid-response'],
    [
      'a response for another request',
      () => new Response(JSON.stringify({ type: 'server-response', rpcId: 'other', result: { ok: true, value: { items: [] } } })),
      'invalid-response',
    ],
  ])('rejects %s from an RPC call', async (_label, response, code) => {
    const client = await connectWith({ api: () => response() })
    await expect(client.sessions.list()).rejects.toMatchObject({ code })
  })

  it('surfaces a remote RPC error with its own code', async () => {
    const client = await connectWith({
      api: rpcId =>
        new Response(JSON.stringify({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'not-found', message: 'No such session.' } } })),
    })
    await expect(client.sessions.list()).rejects.toMatchObject({ code: 'not-found', message: 'No such session.' })
  })
})
