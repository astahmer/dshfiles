import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { HostContext } from '@dshfiles/dshx/effect/host-context'
import { Effect, Layer, Option } from 'effect'
import { afterEach, describe, expect, test } from 'vitest'
import { VcsProviders } from './index.js'
import { VcsProviderService } from './effect.js'

const provider = (input: {
  readonly owner: string
  readonly vcs: string
  readonly priority: number
  readonly claims: (path: string) => boolean
  readonly threadsDirectory?: (repoRoot: string) => string
}) =>
  defineHost({
    apis: [
      VcsProviders.contract(input.owner).host({
        detect: ({ input: request }) => ({
          match: input.claims(request.path)
            ? { vcs: input.vcs, priority: input.priority, repoRoot: request.path, workspaceRoot: request.path, isolated: false }
            : null,
        }),
        threadsDirectories: ({ input: request }) => ({
          directories: request.repoRoots.map(repoRoot => ({ repoRoot, threadsDirectory: (input.threadsDirectory ?? (root => `${root}-threads`))(repoRoot) })),
        }),
        provision: ({ input: request }) => ({ workspaceId: request.workspaceId, isolated: false }),
        snapshot: () => ({ snapshot: `${input.vcs}:1` }),
        restore: () => ({ previous: `${input.vcs}:0` }),
      }),
    ],
  })

let host: TestHost | undefined

afterEach(async () => {
  await host?.dispose()
  host = undefined
})

describe('VcsProviders.resolve', () => {
  test('picks the highest-priority provider that claims the path', async () => {
    host = await createTestHost()
    await host.mount(provider({ owner: '@test/git', vcs: 'git', priority: 10, claims: () => true }), { packageId: '@test/git' })
    await host.mount(provider({ owner: '@test/jj', vcs: 'jj', priority: 100, claims: path => path.startsWith('/jj') }), { packageId: '@test/jj' })

    const colocated = await VcsProviders.resolve(host.ctx, { path: '/jj/repo', callerPackageId: '@test/caller' })
    const plainGit = await VcsProviders.resolve(host.ctx, { path: '/git/repo', callerPackageId: '@test/caller' })

    expect(colocated?.owner).toBe('@test/jj')
    expect(plainGit?.owner).toBe('@test/git')
    expect(await plainGit?.client.snapshot({ path: '/git/repo' })).toEqual({ snapshot: 'git:1' })
  })

  test('answers nothing when no provider claims the path or none is loaded', async () => {
    host = await createTestHost()
    expect(await VcsProviders.resolve(host.ctx, { path: '/anywhere', callerPackageId: '@test/caller' })).toBeUndefined()

    await host.mount(provider({ owner: '@test/jj', vcs: 'jj', priority: 100, claims: () => false }), { packageId: '@test/jj' })
    expect(await VcsProviders.resolve(host.ctx, { path: '/anywhere', callerPackageId: '@test/caller' })).toBeUndefined()
  })

  test('resolves the provider through the Effect service, skipping a provider whose detect fails', async () => {
    host = await createTestHost()
    await host.mount(provider({ owner: '@test/git', vcs: 'git', priority: 10, claims: () => true }), { packageId: '@test/git' })
    await host.mount(
      defineHost({
        apis: [
          VcsProviders.contract('@test/broken').host({
            detect: () => {
              throw new Error('detect exploded')
            },
            threadsDirectories: () => {
              throw new Error('threadsDirectories exploded')
            },
            provision: ({ input: request }) => ({ workspaceId: request.workspaceId, isolated: false }),
            snapshot: () => ({ snapshot: 'broken:1' }),
            restore: () => ({ previous: 'broken:0' }),
          }),
        ],
      }),
      { packageId: '@test/broken' },
    )
    const hostContext = Layer.succeed(HostContext, HostContext.of({ ctx: host.ctx, packageId: '@test/caller' }))

    const service = Effect.gen(function* () {
      const providers = yield* VcsProviderService
      const owners = yield* providers.owners
      const resolved = yield* providers.resolve({ path: '/repo' })
      const snapshot = yield* Option.match(resolved, {
        onNone: () => Effect.succeed(undefined),
        onSome: resolution => resolution.client.snapshot({ path: '/repo' }),
      })
      return { owners, resolved, snapshot }
    }).pipe(Effect.provide(VcsProviderService.layer.pipe(Layer.provide(HostApis.layer), Layer.provide(hostContext))))
    const result = await Effect.runPromise(service)

    expect([...result.owners].sort()).toEqual(['@test/broken', '@test/git'])
    expect(Option.map(result.resolved, resolution => [resolution.owner, resolution.match])).toEqual(
      Option.some(['@test/git', { vcs: 'git', priority: 10, repoRoot: '/repo', workspaceRoot: '/repo', isolated: false }]),
    )
    expect(result.snapshot).toEqual({ snapshot: 'git:1' })
  })
})

describe('VcsProviders.threadsDirectories', () => {
  test("merges every provider's thread directories and skips a provider that fails", async () => {
    host = await createTestHost()
    await host.mount(
      provider({ owner: '@test/jj', vcs: 'jj', priority: 100, claims: () => true, threadsDirectory: repoRoot => `/elsewhere/${repoRoot.split('/').at(-1)}` }),
      { packageId: '@test/jj' },
    )
    await host.mount(provider({ owner: '@test/git', vcs: 'git', priority: 10, claims: () => true }), { packageId: '@test/git' })
    await host.mount(
      defineHost({
        apis: [
          VcsProviders.contract('@test/broken').host({
            detect: () => ({ match: null }),
            threadsDirectories: () => {
              throw new Error('threadsDirectories exploded')
            },
            provision: ({ input: request }) => ({ workspaceId: request.workspaceId, isolated: false }),
            snapshot: () => ({ snapshot: 'broken:1' }),
            restore: () => ({ previous: 'broken:0' }),
          }),
        ],
      }),
      { packageId: '@test/broken' },
    )

    const directories = await VcsProviders.threadsDirectories(host.ctx, { repoRoots: ['/dev/app'], callerPackageId: '@test/caller' })

    expect([...directories].sort((left, right) => left.threadsDirectory.localeCompare(right.threadsDirectory))).toEqual([
      { repoRoot: '/dev/app', threadsDirectory: '/dev/app-threads' },
      { repoRoot: '/dev/app', threadsDirectory: '/elsewhere/app' },
    ])
  })

  test('answers nothing without a provider or a repository root', async () => {
    host = await createTestHost()
    expect(await VcsProviders.threadsDirectories(host.ctx, { repoRoots: ['/dev/app'], callerPackageId: '@test/caller' })).toEqual([])
    await host.mount(provider({ owner: '@test/git', vcs: 'git', priority: 10, claims: () => true }), { packageId: '@test/git' })
    expect(await VcsProviders.threadsDirectories(host.ctx, { repoRoots: [], callerPackageId: '@test/caller' })).toEqual([])
  })
})
