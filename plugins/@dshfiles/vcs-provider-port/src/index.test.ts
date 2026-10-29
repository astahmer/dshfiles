import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { afterEach, describe, expect, test } from 'vitest'
import { VcsProviders } from './index.js'

const provider = (input: { readonly owner: string; readonly vcs: string; readonly priority: number; readonly claims: (path: string) => boolean }) =>
  defineHost({
    apis: [
      VcsProviders.contract(input.owner).host({
        detect: ({ input: request }) => ({
          match: input.claims(request.path)
            ? { vcs: input.vcs, priority: input.priority, repoRoot: request.path, workspaceRoot: request.path, isolated: false }
            : null,
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
})
