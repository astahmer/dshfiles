import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { createServer as createNetServer, type Server as NetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Schema from 'effect/Schema'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import multiHostHost from '../src/host.js'

// The wire shape of each failure class a multi-host API call surfaces. Two shapes exist: value handlers report
// `{ ok: false, code, message }`, and failing Effect handlers reach the wire as their tagged error's own code. Both keep
// the domain code; the facade's generic `multi-host-handler-error` is gone.

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-ssh.mjs')
const originalPath = process.env.PATH
const originalHome = process.env.DSH_HOME
const temporary: string[] = []
const servers: Server[] = []
let host: TestHost

const wireEnvelope = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({ output: Schema.Unknown }) }),
    Schema.Struct({ ok: Schema.Literal(false), error: Schema.Struct({ code: Schema.String, message: Schema.String }) }),
  ]),
})
const failedOutput = Schema.Struct({ ok: Schema.Literal(false), code: Schema.String, message: Schema.String })

type WireOutcome =
  | { readonly shape: 'value'; readonly code: string; readonly message: string }
  | { readonly shape: 'error'; readonly code: string; readonly message: string }
  | { readonly shape: 'success' }

type ApiInput = Parameters<TestHost['connection']['requestApi']>[0]['input']

const call = async (method: string, input: ApiInput): Promise<WireOutcome> => {
  const response = await host.connection.requestApi({ packageId: '@dshfiles/multi-host', apiId: 'multi-host', method, version: 1, input })
  const envelope = Schema.decodeUnknownSync(wireEnvelope)(await response.json())
  if (!envelope.result.ok) return { shape: 'error', code: envelope.result.error.code, message: envelope.result.error.message }
  const failed = Schema.decodeUnknownOption(failedOutput)(envelope.result.value.output)
  if (failed._tag === 'Some') return { shape: 'value', code: failed.value.code, message: failed.value.message }
  return { shape: 'success' }
}

const withSshStderr = async <Result>(stderr: string, run: () => Promise<Result>): Promise<Result> => {
  process.env.FAKE_SSH_FORCE_STDERR = stderr
  try {
    return await run()
  } finally {
    delete process.env.FAKE_SSH_FORCE_STDERR
  }
}

const portOf = (server: Pick<NetServer, 'address'>): number => Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address()).port

const closedPort = async (): Promise<number> => {
  const server = createNetServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = portOf(server)
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

/** A loopback DSH that accepts the launch handoff but serves no multi-host identity API. */
const runtimeWithoutIdentity = async (): Promise<number> => {
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.startsWith('/?token=')) {
      response.writeHead(303, { location: '/', 'set-cookie': 'dsh-auth-fixture=1; Path=/; HttpOnly' })
      response.end()
      return
    }
    request.resume()
    request.on('end', () => {
      response.writeHead(404, { 'content-type': 'text/plain' })
      response.end('not found')
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return portOf(server)
}

const sshTestInput = (remoteHome: string) => ({ name: 'Box', sshTarget: 'tester@box', remoteHome })

const localRuntime = (port: number) => ({
  hostId: 'local-host',
  name: 'Local runtime',
  locator: { kind: 'local', launchUrl: `http://127.0.0.1:${port}/?token=fixture-token-12345678` },
})

beforeAll(async () => {
  const home = await mkdtemp(join(tmpdir(), 'multi-host-wire-home-'))
  const bin = await mkdtemp(join(tmpdir(), 'multi-host-wire-bin-'))
  temporary.push(home, bin)
  await writeFile(join(bin, 'ssh'), `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" "$@"\n`)
  await chmod(join(bin, 'ssh'), 0o755)
  process.env.PATH = `${bin}:${originalPath ?? ''}`
  process.env.DSH_HOME = home
  host = await createTestHost()
  // The real Host provides DSH's subprocess runtime; ssh runs through it.
  await host.ctx.plugin(LocalSubprocessRuntime)
  await host.mount(multiHostHost, { packageId: '@dshfiles/multi-host', config: {} })
  expect(await call('hostUpsert', { id: 'local-host', name: 'Local', connector: { kind: 'local' } })).toEqual({ shape: 'success' })
})

afterAll(async () => {
  await host.dispose()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
  process.env.PATH = originalPath
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('multi-host wire failures by class', () => {
  const cases: ReadonlyArray<{ readonly name: string; readonly run: () => Promise<WireOutcome>; readonly expected: Record<string, string> }> = [
    {
      name: 'unknown runtime, value handler (runtimePing)',
      run: () => call('runtimePing', { runtimeId: 'missing-runtime' }),
      expected: { shape: 'value', code: 'runtime-not-found' },
    },
    {
      name: 'unknown runtime, native RPC handler (runtimeCall)',
      run: () => call('runtimeCall', { runtimeId: 'missing-runtime', request: { namespace: 'session', method: 'list', args: {} } }),
      expected: { shape: 'value', code: 'runtime-not-found' },
    },
    {
      name: 'unknown runtime, status handler (runtimeStatus)',
      run: () => call('runtimeStatus', { runtimeId: 'missing-runtime' }),
      expected: { shape: 'value', code: 'runtime-not-found' },
    },
    {
      // These three used to reach the wire as the generic `multi-host-handler-error`: `effectHandler` flattened every
      // thrown failure into it. Handlers are Effect handlers with the domain's own tagged errors now, so each keeps
      // its own wire code, like the value handlers above always did.
      name: 'unknown runtime, failing Effect handler (runtimeOpenView) keeps its domain code',
      run: () => call('runtimeOpenView', { runtimeId: 'missing-runtime' }),
      expected: { shape: 'error', code: 'runtime-not-found' },
    },
    {
      name: 'unknown runtime, failing Effect handler (sessionCursor) keeps its domain code',
      run: () => call('sessionCursor', { runtimeId: 'missing-runtime', sessionId: 'session-1' }),
      expected: { shape: 'error', code: 'runtime-not-found' },
    },
    {
      name: 'unknown host, failing Effect handler (hostSetHidden) keeps its domain code',
      run: () => call('hostSetHidden', { id: 'missing-host', hidden: true }),
      expected: { shape: 'error', code: 'host-not-found' },
    },
    {
      name: 'unknown host remove is a no-op, not a failure',
      run: () => call('hostRemove', { id: 'missing-host', removeDirectory: false }),
      expected: { shape: 'success' },
    },
    {
      name: 'gateway unreachable on registration',
      run: async () => call('runtimeUpsert', localRuntime(await closedPort())),
      expected: { shape: 'value', code: 'gateway-unreachable' },
    },
    {
      name: 'runtime without the identity API on registration',
      run: async () => call('runtimeUpsert', localRuntime(await runtimeWithoutIdentity())),
      expected: { shape: 'value', code: 'identity-unavailable' },
    },
    {
      name: 'ssh authentication failure (testConnection)',
      run: () => withSshStderr('tester@box: Permission denied (publickey).', () => call('testConnection', sshTestInput('/home/tester/.dsh'))),
      expected: { shape: 'value', code: 'ssh-authentication-failed' },
    },
    {
      name: 'ssh host key rejected (testConnection)',
      run: () => withSshStderr('Host key verification failed.', () => call('testConnection', sshTestInput('/home/tester/.dsh'))),
      expected: { shape: 'value', code: 'host-key-rejected' },
    },
    {
      name: 'ssh host unresolved (discoverHomes)',
      run: () => withSshStderr('ssh: Could not resolve hostname box', () => call('discoverHomes', { sshTarget: 'tester@box' })),
      expected: { shape: 'value', code: 'ssh-host-unresolved' },
    },
    {
      name: 'ssh unreachable (discoverHomes)',
      run: () => withSshStderr('ssh: connect to host box port 22: Connection refused', () => call('discoverHomes', { sshTarget: 'tester@box' })),
      expected: { shape: 'value', code: 'ssh-unreachable' },
    },
    {
      name: 'remote home without a launch file (testConnection)',
      run: async () => {
        const remoteHome = await mkdtemp(join(tmpdir(), 'multi-host-wire-remote-'))
        temporary.push(remoteHome)
        return call('testConnection', sshTestInput(remoteHome))
      },
      expected: { shape: 'value', code: 'runtime-not-running' },
    },
    {
      name: 'input outside the API schema',
      run: () => call('runtimePing', { runtimeId: '' }),
      expected: { shape: 'error', code: 'contract' },
    },
  ]

  test.each(cases)('$name', async ({ run, expected }) => {
    const outcome = await run()
    expect(outcome).toMatchObject(expected)
    if (outcome.shape !== 'success') expect(outcome.message.length).toBeGreaterThan(0)
  })

  test('a failed connection test still reports the hops that ran', async () => {
    const remoteHome = await mkdtemp(join(tmpdir(), 'multi-host-wire-remote-'))
    temporary.push(remoteHome)
    const response = await host.connection.requestApi({
      packageId: '@dshfiles/multi-host',
      apiId: 'multi-host',
      method: 'testConnection',
      version: 1,
      input: sshTestInput(remoteHome),
    })
    const envelope = Schema.decodeUnknownSync(wireEnvelope)(await response.json())
    if (!envelope.result.ok) throw new Error(envelope.result.error.message)
    expect(envelope.result.value.output).toMatchObject({
      ok: false,
      code: 'runtime-not-running',
      steps: [
        { step: 'ssh', ok: true },
        { step: 'runtime', ok: false, code: 'runtime-not-running' },
      ],
    })
  })
})
