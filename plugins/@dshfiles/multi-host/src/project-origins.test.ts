import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect, Layer, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { expect, test } from 'vitest'
import { HostDirectory } from './host-directory.js'
import type { HostDirectory as HostDirectoryValue, HostRecord, RuntimeRecord } from './records.js'
import { normalizeProjectOrigin, readProjectOrigins } from './project-origins.js'
import { Ssh } from './ssh.js'
import type { SshResult, SshRun } from './ssh.js'

const unused = () => Effect.die('This test path does not use this operation.')
const emptyDirectory: HostDirectoryValue = { schemaVersion: 2, hosts: [], runtimes: [], retiredPorts: [] }
const testServices = (
  input: {
    readonly host?: HostRecord
    readonly runtimes?: readonly RuntimeRecord[]
    readonly sshRun?: (request: SshRun) => Effect.Effect<SshResult>
  } = {},
) => {
  const hosts = input.host === undefined ? [] : [input.host]
  const runtimes = input.runtimes ?? []
  return Layer.mergeAll(
    NodeServices.layer,
    tracerLayer,
    Layer.succeed(
      HostDirectory,
      HostDirectory.of({
        read: Effect.succeed({ ...emptyDirectory, hosts, runtimes: [...runtimes] }),
        listHosts: Effect.succeed(hosts),
        listRuntimes: () => Effect.succeed(runtimes),
        findHost: id => Effect.succeed(hosts.find(host => host.id === id)),
        findRuntime: id => Effect.succeed(runtimes.find(runtime => runtime.id === id)),
        upsertHost: unused,
        setHostHidden: unused,
        setHostSettings: unused,
        reorderHosts: unused,
        upsertRuntime: unused,
        removeRuntime: unused,
        removeHost: unused,
        changes: Stream.empty,
      }),
    ),
    Layer.succeed(Ssh, Ssh.of({ run: input.sshRun ?? unused, exec: unused, tunnel: unused })),
  )
}

test('normalizes common Git origin formats to a lowercase host and repository path', () => {
  expect(normalizeProjectOrigin('git@GitHub.com:Astahmer/dshfiles.git')).toBe('github.com/Astahmer/dshfiles')
  expect(normalizeProjectOrigin('https://GitHub.com/Astahmer/dshfiles.git/')).toBe('github.com/Astahmer/dshfiles')
  expect(normalizeProjectOrigin('ssh://git@GitHub.com/Astahmer/dshfiles/')).toBe('github.com/Astahmer/dshfiles')
  expect(normalizeProjectOrigin('')).toBeNull()
  expect(normalizeProjectOrigin('file:///work/dshfiles')).toBeNull()
  expect(normalizeProjectOrigin('not a repository URL')).toBeNull()
})

test('caches a local Git origin until its .git/config changes', async () => {
  const path = await mkdtemp(join(tmpdir(), 'multi-host-project-origin-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: path })
    execFileSync('git', ['-C', path, 'config', 'remote.origin.url', 'git@GitHub.com:Owner/Repo.git'])
    const services = testServices()
    const read = () => Effect.runPromise(readProjectOrigins({ localPaths: [path], remote: [] }).pipe(Effect.provide(services)))
    using recorder = recordSpans()
    const first = await read()
    const cached = await read()
    execFileSync('git', ['-C', path, 'config', 'remote.origin.url', 'https://github.com/owner/updated.git'])
    const updated = await read()

    expect(first.origins).toEqual([{ kind: 'local', path, origin: 'github.com/Owner/Repo' }])
    expect(cached.origins).toEqual(first.origins)
    expect(updated.origins).toEqual([{ kind: 'local', path, origin: 'github.com/owner/updated' }])
    expect(recorder.named('multi-host project origins').map(span => span.attributes['dshx.multi-host.origin_local_reads'])).toEqual([1, 0, 1])
  } finally {
    await rm(path, { recursive: true, force: true })
  }
})

test('reads all runtimes on one SSH host in one command and caches by runtime path', async () => {
  const host: HostRecord = {
    schemaVersion: 2,
    id: 'host-a',
    name: 'Build box',
    connector: { kind: 'ssh', sshTarget: 'build-box' },
    hidden: false,
    createdAt: '2026-11-04T00:00:00.000Z',
  }
  const runtimes: RuntimeRecord[] = ['runtime-a', 'runtime-b'].map(id => ({
    schemaVersion: 2,
    id,
    hostId: host.id,
    name: id,
    locator: { kind: 'ssh', remoteHome: '/home/remote' },
    identity: null,
    createdAt: '2026-11-04T00:00:00.000Z',
  }))
  const path = "/work/Atlas's project"
  const commands: string[] = []
  const services = testServices({
    host,
    runtimes,
    sshRun: request =>
      Effect.sync(() => {
        commands.push(request.command)
        return {
          code: 0,
          stdout: `${path}\tgit@GitHub.com:Owner/Repo.git\n`,
          stderr: '',
          timedOut: false,
          outputExceeded: false,
          durationMs: 1,
        }
      }),
  })
  const input = {
    localPaths: [],
    remote: [
      { runtimeId: 'runtime-a', paths: [path] },
      { runtimeId: 'runtime-b', paths: [path] },
    ],
  }
  const first = await Effect.runPromise(readProjectOrigins(input).pipe(Effect.provide(services)))
  const second = await Effect.runPromise(readProjectOrigins(input).pipe(Effect.provide(services)))

  expect(first.origins.map(entry => entry.origin)).toEqual(['github.com/Owner/Repo', 'github.com/Owner/Repo'])
  expect(second.origins).toEqual(first.origins)
  expect(commands).toHaveLength(1)
  expect(commands[0]).toContain("'/work/Atlas'\\''s project'")
})

test('answers pending instead of waiting for an unreachable SSH host, and joins its one read', async () => {
  const host: HostRecord = {
    schemaVersion: 2,
    id: 'host-slow',
    name: 'Asleep',
    connector: { kind: 'ssh', sshTarget: 'asleep' },
    hidden: false,
    createdAt: '2026-11-04T00:00:00.000Z',
  }
  const runtime: RuntimeRecord = {
    schemaVersion: 2,
    id: 'runtime-slow',
    hostId: host.id,
    name: 'asleep',
    locator: { kind: 'ssh', remoteHome: '/home/remote' },
    identity: null,
    createdAt: '2026-11-04T00:00:00.000Z',
  }
  let runs = 0
  const services = testServices({
    host,
    runtimes: [runtime],
    sshRun: () =>
      Effect.sync(() => {
        runs += 1
      }).pipe(
        Effect.andThen(Effect.sleep('2500 millis')),
        Effect.as({ code: 255, stdout: '', stderr: '', timedOut: false, outputExceeded: false, durationMs: 2500 }),
      ),
  })
  const input = { localPaths: [], remote: [{ runtimeId: runtime.id, paths: ['/work/slow'] }] }
  const read = () => Effect.runPromise(readProjectOrigins(input).pipe(Effect.provide(services)))

  const started = performance.now()
  const [first, joined] = await Promise.all([read(), read()])
  const waitedMs = performance.now() - started
  await new Promise(resolve => setTimeout(resolve, 1_200))
  const settled = await read()

  expect(waitedMs).toBeLessThan(2_000)
  expect(first).toEqual({ origins: [{ kind: 'remote', runtimeId: runtime.id, path: '/work/slow', origin: null }], pending: true })
  expect(joined).toEqual(first)
  expect(settled).toEqual({ origins: first.origins })
  expect(runs).toBe(1)
})

const sshHost = (input: { readonly id: string; readonly sshTarget: string }): HostRecord => ({
  schemaVersion: 2,
  id: input.id,
  name: input.id,
  connector: { kind: 'ssh', sshTarget: input.sshTarget },
  hidden: false,
  createdAt: '2026-11-04T00:00:00.000Z',
})
const sshRuntime = (input: { readonly id: string; readonly hostId: string }): RuntimeRecord => ({
  schemaVersion: 2,
  id: input.id,
  hostId: input.hostId,
  name: input.id,
  locator: { kind: 'ssh', remoteHome: '/home/remote' },
  identity: null,
  createdAt: '2026-11-04T00:00:00.000Z',
})
const sshAnswer = (input: { readonly code: number; readonly stdout: string }): SshResult => ({
  code: input.code,
  stdout: input.stdout,
  stderr: '',
  timedOut: false,
  outputExceeded: false,
  durationMs: 1,
})

test('retries a failed remote origin read well before the success lifetime ends', async () => {
  const host = sshHost({ id: 'host-flaky', sshTarget: 'flaky' })
  const runtime = sshRuntime({ id: 'runtime-flaky', hostId: host.id })
  let runs = 0
  const services = testServices({
    host,
    runtimes: [runtime],
    sshRun: () =>
      Effect.sync(() => {
        runs += 1
        return runs === 1 ? sshAnswer({ code: 255, stdout: '' }) : sshAnswer({ code: 0, stdout: '/work/flaky\tgit@github.com:owner/flaky.git\n' })
      }),
  })
  const read = readProjectOrigins({ localPaths: [], remote: [{ runtimeId: runtime.id, paths: ['/work/flaky'] }] })

  const [failed, retried] = await Effect.runPromise(
    Effect.gen(function* () {
      const failed = yield* read
      yield* TestClock.adjust('60 seconds')
      return [failed, yield* read] as const
    }).pipe(Effect.provide(Layer.merge(services, TestClock.layer()))),
  )

  expect(failed.origins[0]?.origin).toBeNull()
  expect(retried.origins[0]?.origin).toBe('github.com/owner/flaky')
  expect(runs).toBe(2)
})

test('drops cached remote origins when the host connector changes', async () => {
  const runtime = sshRuntime({ id: 'runtime-moved', hostId: 'host-moved' })
  const targets: string[] = []
  const servicesFor = (sshTarget: string) =>
    testServices({
      host: sshHost({ id: 'host-moved', sshTarget }),
      runtimes: [runtime],
      sshRun: request =>
        Effect.sync(() => {
          targets.push(request.sshTarget)
          return sshAnswer({ code: 0, stdout: `/work/moved\tgit@github.com:owner/${request.sshTarget}.git\n` })
        }),
    })
  const read = (sshTarget: string) =>
    Effect.runPromise(
      readProjectOrigins({ localPaths: [], remote: [{ runtimeId: runtime.id, paths: ['/work/moved'] }] }).pipe(Effect.provide(servicesFor(sshTarget))),
    )

  const before = await read('old-box')
  const after = await read('new-box')

  expect(before.origins[0]?.origin).toBe('github.com/owner/old-box')
  expect(after.origins[0]?.origin).toBe('github.com/owner/new-box')
  expect(targets).toEqual(['old-box', 'new-box'])
})

test('records the project origins span without exposing input paths', async () => {
  using recorder = recordSpans()
  const result = await Effect.runPromise(
    readProjectOrigins({ localPaths: [], remote: [{ runtimeId: 'unknown-runtime', paths: ['/work/private'] }] }).pipe(Effect.provide(testServices())),
  )
  expect(result.origins).toEqual([{ kind: 'remote', runtimeId: 'unknown-runtime', path: '/work/private', origin: null }])
  expect(recorder.span('multi-host project origins')).toBeDefined()
  expect(JSON.stringify(recorder.span('multi-host project origins')?.attributes)).not.toContain('/work/private')
})
