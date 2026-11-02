import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect, Exit, Layer, ManagedRuntime, Schema, Scope } from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { LegacyRuntime, type Gateway } from '../src/legacy-runtime-promise.js'
import { SshConnector } from '../src/connectors/ssh.js'
import { LaunchFile } from '../src/launch-file.js'
import { dataRunner } from './fixtures/data-runtime.js'
import { MultiHostSchema } from '../src/schema.js'
import { Ssh, type SshRun } from '../src/ssh.js'
import { exitCode, sshLayer } from './fixtures/ssh-runtime.js'

// Characterization of the ssh process and tunnel contract, pinned before it moved onto the Effect `Ssh` service and
// kept as its spec. Only the ssh executable is faked: a script on PATH that runs the "remote" command locally and
// fakes `-L` with a TCP proxy. A cancelled request is an interrupted fiber, read here as `cancelled`.

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-ssh.mjs')
const target = 'tester@fake-host'
const originalPath = process.env.PATH
const temporary: string[] = []
let binDirectory = ''
let logPath = ''

const scratch = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  temporary.push(directory)
  return directory
}

const runtime = ManagedRuntime.make(Layer.mergeAll(sshLayer, FetchHttpClient.layer))
const data = dataRunner({ DSH_HOME: '/nonexistent/multi-host-ssh-test' })
const writeLaunchFile = (input: { readonly dshHome: string; readonly launchUrl: string }) => data.run(LaunchFile.use(launchFile => launchFile.write(input)))

const failureCode = async (effect: Effect.Effect<unknown, unknown, Ssh | HttpClient.HttpClient | Scope.Scope>, signal?: AbortSignal): Promise<string> =>
  exitCode(await runtime.runPromiseExit(Effect.scoped(effect), signal === undefined ? undefined : { signal }))

const run = (input: SshRun, signal?: AbortSignal) =>
  runtime.runPromise(
    Ssh.use(ssh => ssh.run(input)),
    signal === undefined ? undefined : { signal },
  )

const runEffect = (input: SshRun) => Ssh.use(ssh => ssh.run(input))

const probe = (input: { readonly sshTarget: string }) => SshConnector.probe(input)

/** A gateway whose tunnel lives until `dispose` closes its Scope. */
const connect = async (input: { readonly sshTarget: string; readonly remoteHome: string }): Promise<Gateway> => {
  const scope = await runtime.runPromise(Scope.make())
  const exit = await runtime.runPromiseExit(Scope.provide(scope)(SshConnector.connect(input)))
  if (Exit.isFailure(exit)) {
    await runtime.runPromise(Scope.close(scope, exit))
    throw new Error(exitCode(exit))
  }
  return LegacyRuntime.toPromiseGateway({ gateway: exit.value, close: () => runtime.runPromise(Scope.close(scope, Exit.void)) })
}

const logLines = async (): Promise<string[]> => {
  try {
    return (await readFile(logPath, 'utf8')).trim().split('\n')
  } catch {
    return []
  }
}

const fakePid = async (): Promise<number> => {
  const line = (await logLines()).find(entry => entry.startsWith('pid '))
  return Number(line?.slice(4))
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

beforeAll(async () => {
  binDirectory = await scratch('multi-host-fake-ssh-bin-')
  const launcher = join(binDirectory, 'ssh')
  await writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${fixturePath}" "$@"\n`)
  await chmod(launcher, 0o755)
  process.env.PATH = `${binDirectory}:${originalPath ?? ''}`
})

afterAll(async () => {
  await runtime.dispose()
  await data.dispose()
  process.env.PATH = originalPath
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})

beforeEach(async () => {
  logPath = join(await scratch('multi-host-fake-ssh-log-'), 'ssh.log')
  process.env.FAKE_SSH_LOG = logPath
  delete process.env.FAKE_SSH_TUNNEL
  delete process.env.FAKE_SSH_IGNORE_TERM
})

describe('ssh run', () => {
  test('passes BatchMode options and the target before the remote command', async () => {
    await run({ sshTarget: target, command: 'true' })
    const argv = JSON.parse((await logLines()).find(line => line.startsWith('argv '))?.slice(5) ?? '[]')
    expect(argv).toEqual([
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ForwardAgent=no',
      '-o',
      'PermitLocalCommand=no',
      '-o',
      'ConnectTimeout=8',
      '-o',
      'ServerAliveInterval=10',
      '-o',
      'ServerAliveCountMax=2',
      target,
      'true',
    ])
  })

  test('a non-zero remote exit is a value with both streams, not a failure', async () => {
    const result = await run({ sshTarget: target, command: 'echo out; echo err >&2; exit 3' })
    expect(result).toMatchObject({ code: 3, stdout: 'out\n', stderr: 'err\n', timedOut: false, outputExceeded: false })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('a run past its time limit resolves with timedOut and a null code', async () => {
    const result = await run({ sshTarget: target, command: 'sleep 5', timeout: 200 })
    expect(result).toMatchObject({ code: null, timedOut: true, outputExceeded: false })
    expect(result.durationMs).toBeLessThan(2_000)
  })

  test('output past its byte limit stops the process and flags outputExceeded, keeping only what fit', async () => {
    const result = await run({ sshTarget: target, command: 'printf 1234567890; sleep 5', maxOutputBytes: 4 })
    expect(result).toMatchObject({ outputExceeded: true, timedOut: false, stdout: '' })
    expect(result.durationMs).toBeLessThan(4_000)
  })

  test('stdin bytes reach the remote command', async () => {
    const result = await run({ sshTarget: target, command: 'wc -c', stdin: new TextEncoder().encode('hello') })
    expect(result.stdout.trim()).toBe('5')
  })

  test('stdin over 60 MiB is refused before ssh starts', async () => {
    expect(await failureCode(runEffect({ sshTarget: target, command: 'true', stdin: new Uint8Array(60 * 1024 * 1024 + 1) }))).toBe('ssh-input-too-large')
    expect(await logLines()).toEqual([])
  })

  test('an already-aborted signal is refused before ssh starts', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await failureCode(runEffect({ sshTarget: target, command: 'true' }), controller.signal)).toBe('cancelled')
    expect(await logLines()).toEqual([])
  })

  test('cancelling rejects at once, then stops ssh with SIGTERM and SIGKILL after the grace period', async () => {
    process.env.FAKE_SSH_IGNORE_TERM = '1'
    const controller = new AbortController()
    const running = failureCode(runEffect({ sshTarget: target, command: 'sleep 4' }), controller.signal)
    await expect.poll(fakePid).toBeGreaterThan(0)
    const pid = await fakePid()
    controller.abort()
    expect(await running).toBe('cancelled')
    await expect.poll(logLines).toContain('signal SIGTERM')
    expect(isAlive(pid)).toBe(true)
    await expect.poll(() => isAlive(pid), { timeout: 4_000 }).toBe(false)
  }, 10_000)

  test('a missing ssh executable rejects with ssh-unavailable', async () => {
    process.env.PATH = '/nonexistent'
    try {
      expect(await failureCode(runEffect({ sshTarget: target, command: 'true' }))).toBe('ssh-unavailable')
    } finally {
      process.env.PATH = `${binDirectory}:${originalPath ?? ''}`
    }
  })

  test('a shell-shaped target is refused before ssh starts', async () => {
    expect(await failureCode(runEffect({ sshTarget: 'host; rm -rf /', command: 'true' }))).toBe('invalid-ssh-target')
    expect(await logLines()).toEqual([])
  })
})

describe('ssh command failures map to stable codes', () => {
  test.each([
    ['Host key verification failed.', 'host-key-rejected'],
    ['WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!', 'host-key-rejected'],
    ['tester@fake-host: Permission denied (publickey).', 'ssh-authentication-failed'],
    ['ssh: Could not resolve hostname fake-host: nodename nor servname provided', 'ssh-host-unresolved'],
    ['ssh: connect to host fake-host port 22: Connection refused', 'ssh-unreachable'],
    ['ssh: connect to host fake-host port 22: Operation timed out', 'ssh-unreachable'],
    ['something else entirely', 'ssh-command-failed'],
  ])('probe stderr %j → %s', async (stderr, code) => {
    process.env.FAKE_SSH_FORCE_STDERR = stderr
    try {
      expect(await failureCode(probe({ sshTarget: target }))).toBe(code)
    } finally {
      delete process.env.FAKE_SSH_FORCE_STDERR
    }
  })

  test('a probe that succeeds resolves', async () => {
    expect(await failureCode(probe({ sshTarget: target }))).toBe('no-error')
  })

  test('a command over the default 128 KiB output limit is ssh-output-too-large', async () => {
    process.env.FAKE_SSH_FORCE_STDOUT_BYTES = String(200 * 1024)
    try {
      expect(await failureCode(probe({ sshTarget: target }))).toBe('ssh-output-too-large')
    } finally {
      delete process.env.FAKE_SSH_FORCE_STDOUT_BYTES
    }
  })
})

const startRuntimeFixture = async () => {
  const calls: string[] = []
  const server: Server = createServer((request, response) => {
    if (request.method === 'GET' && request.url?.startsWith('/?token=')) {
      response.writeHead(303, { location: '/', 'set-cookie': 'dsh-auth-fixture=1; Path=/; HttpOnly' })
      response.end()
      return
    }
    const body: string[] = []
    request.setEncoding('utf8')
    request.on('data', chunk => body.push(chunk))
    request.on('end', () => {
      calls.push(request.url ?? '')
      const rpcId = MultiHostSchema.decode(Schema.Struct({ rpcId: Schema.String }).pipe(MultiHostSchema.passthrough), JSON.parse(body.join(''))).rpcId
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value: { items: [] } } }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address()).port
  return { calls, port, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

describe('ssh tunnel connect', () => {
  const closers: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close()
  })

  const remoteHomeWithLaunch = async (port: number): Promise<string> => {
    const home = await scratch('multi-host-fake-remote-home-')
    await writeLaunchFile({ dshHome: home, launchUrl: `http://127.0.0.1:${port}/?token=fake-remote-token-123456` })
    return home
  }

  test('reads the remote launch file, waits for the readiness line, then serves requests through the forward', async () => {
    const runtime = await startRuntimeFixture()
    closers.push(runtime.close)
    const remoteHome = await remoteHomeWithLaunch(runtime.port)
    const gateway = await connect({ sshTarget: target, remoteHome })
    closers.push(() => gateway.dispose())
    expect(new URL(gateway.origin).hostname).toBe('127.0.0.1')
    expect(new URL(gateway.origin).port).not.toBe(String(runtime.port))
    expect(await gateway.run('session', 'list', { _request: {} })).toEqual({ items: [] })
    expect(runtime.calls).toContain('/api/session/list')

    const argvLines = (await logLines()).filter(line => line.startsWith('argv '))
    expect(argvLines).toHaveLength(2)
    const tunnelArgv: string[] = JSON.parse(argvLines[1]?.slice(5) ?? '[]')
    expect(tunnelArgv).toEqual(expect.arrayContaining(['-v', '-N', '-L', `127.0.0.1:${new URL(gateway.origin).port}:127.0.0.1:${runtime.port}`, target]))
  })

  test('disposing the gateway stops the tunnel process and settles closed', async () => {
    const runtime = await startRuntimeFixture()
    closers.push(runtime.close)
    const gateway = await connect({ sshTarget: target, remoteHome: await remoteHomeWithLaunch(runtime.port) })
    const pids = (await logLines()).filter(line => line.startsWith('pid ')).map(line => Number(line.slice(4)))
    const tunnelPid = pids.at(-1) ?? 0
    expect(isAlive(tunnelPid)).toBe(true)
    await gateway.dispose()
    await gateway.closed
    await expect.poll(() => isAlive(tunnelPid)).toBe(false)
  })

  test('a tunnel process that dies on its own settles closed', async () => {
    const runtime = await startRuntimeFixture()
    closers.push(runtime.close)
    const gateway = await connect({ sshTarget: target, remoteHome: await remoteHomeWithLaunch(runtime.port) })
    closers.push(() => gateway.dispose())
    const tunnelPid = (await logLines())
      .filter(line => line.startsWith('pid '))
      .map(line => Number(line.slice(4)))
      .at(-1)
    process.kill(tunnelPid ?? 0, 'SIGKILL')
    await gateway.closed
  })

  test('a remote home without a launch file is runtime-not-running and opens no tunnel', async () => {
    const remoteHome = await scratch('multi-host-fake-remote-empty-')
    expect(await failureCode(SshConnector.connect({ sshTarget: target, remoteHome }))).toBe('runtime-not-running')
    expect((await logLines()).filter(line => line.startsWith('argv '))).toHaveLength(1)
  })

  test('a launch file pointing at a closed port is runtime-not-running after the forward opens', async () => {
    const runtime = await startRuntimeFixture()
    const port = runtime.port
    await runtime.close()
    const remoteHome = await remoteHomeWithLaunch(port)
    expect(await failureCode(SshConnector.connect({ sshTarget: target, remoteHome }))).toBe('runtime-not-running')
  })

  test('a forward that exits before its readiness line is tunnel-failed', async () => {
    process.env.FAKE_SSH_TUNNEL = 'exit'
    expect(await failureCode(SshConnector.connect({ sshTarget: target, remoteHome: remoteHomeFixed }))).toBe('tunnel-failed')
  })

  test('a forward that exits with a recognizable ssh error keeps that error code', async () => {
    process.env.FAKE_SSH_TUNNEL = 'refused'
    expect(await failureCode(SshConnector.connect({ sshTarget: target, remoteHome: remoteHomeFixed }))).toBe('ssh-unreachable')
  })

  test('a forward that never reports readiness is tunnel-timeout after 12 s and its process is stopped', async () => {
    process.env.FAKE_SSH_TUNNEL = 'silent'
    const startedAt = Date.now()
    expect(await failureCode(SshConnector.connect({ sshTarget: target, remoteHome: remoteHomeFixed }))).toBe('tunnel-timeout')
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(11_900)
    const tunnelPid = (await logLines())
      .filter(line => line.startsWith('pid '))
      .map(line => Number(line.slice(4)))
      .at(-1)
    await expect.poll(() => isAlive(tunnelPid ?? 0)).toBe(false)
  }, 20_000)

  test('cancelling while the forward starts rejects with cancelled and stops the process', async () => {
    process.env.FAKE_SSH_TUNNEL = 'silent'
    const controller = new AbortController()
    const connecting = failureCode(SshConnector.connect({ sshTarget: target, remoteHome: remoteHomeFixed }), controller.signal)
    await expect.poll(async () => (await logLines()).filter(line => line.startsWith('argv ')).length).toBe(2)
    controller.abort()
    expect(await connecting).toBe('cancelled')
  })

  let remoteHomeFixed = ''
  beforeAll(async () => {
    remoteHomeFixed = await scratch('multi-host-fake-remote-fixed-')
    await writeLaunchFile({ dshHome: remoteHomeFixed, launchUrl: 'http://127.0.0.1:9/?token=fake-remote-token-123456' })
  })
})
