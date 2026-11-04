import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect, Layer } from 'effect'
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

test('reads and caches a local Git origin using the requested project path', async () => {
  const path = await mkdtemp(join(tmpdir(), 'multi-host-project-origin-'))
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: path })
    execFileSync('git', ['-C', path, 'config', 'remote.origin.url', 'git@GitHub.com:Owner/Repo.git'])
    const services = testServices()
    const first = await Effect.runPromise(readProjectOrigins({ localPaths: [path], remote: [] }).pipe(Effect.provide(services)))
    execFileSync('git', ['-C', path, 'config', 'remote.origin.url', 'https://github.com/owner/updated.git'])
    const second = await Effect.runPromise(readProjectOrigins({ localPaths: [path], remote: [] }).pipe(Effect.provide(services)))

    expect(first.origins).toEqual([{ kind: 'local', path, origin: 'github.com/Owner/Repo' }])
    expect(second.origins).toEqual(first.origins)
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

test('records the project origins span without exposing input paths', async () => {
  using recorder = recordSpans()
  const result = await Effect.runPromise(
    readProjectOrigins({ localPaths: [], remote: [{ runtimeId: 'unknown-runtime', paths: ['/work/private'] }] }).pipe(Effect.provide(testServices())),
  )
  expect(result.origins).toEqual([{ kind: 'remote', runtimeId: 'unknown-runtime', path: '/work/private', origin: null }])
  expect(recorder.span('multi-host project origins')).toBeDefined()
  expect(JSON.stringify(recorder.span('multi-host project origins')?.attributes)).not.toContain('/work/private')
})
