import { defineHost } from '@dshfiles/dshx/host'
import { createTestHost, type TestHost } from '@dshfiles/dshx/testing'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { Effect } from 'effect'
import { afterEach, describe, expect, test } from 'vitest'
import { loadThreadDirectories } from './thread-directories-promise.js'
import { WorkspacePaths } from './workspace-paths.js'

const provider = (owner: string, threadsDirectory: (repoRoot: string) => string) =>
  defineHost({
    apis: [
      VcsProviders.contract(owner).host({
        detect: () => ({ match: null }),
        threadsDirectories: ({ input }) => ({ directories: input.repoRoots.map(repoRoot => ({ repoRoot, threadsDirectory: threadsDirectory(repoRoot) })) }),
        provision: ({ input }) => ({ workspaceId: input.workspaceId, isolated: false }),
        snapshot: () => ({ snapshot: 'none' }),
        restore: () => ({ previous: 'none' }),
      }),
    ],
  })

let host: TestHost | undefined

afterEach(async () => {
  await host?.dispose()
  host = undefined
})

describe('loadThreadDirectories', () => {
  test('attributes a custom-directory thread workspace through the provider and keeps the default layout', async () => {
    host = await createTestHost()
    await host.mount(
      provider('@test/jj', repoRoot => `/elsewhere/${repoRoot.split('/').at(-1) ?? ''}`),
      { packageId: '@test/jj' },
    )
    const ctx = host.ctx

    const threadDirectories = await Effect.runPromise(loadThreadDirectories({ ctx, packageId: '@dshfiles/thread-sidebar', projectPaths: ['/dev/app'] }))

    expect(WorkspacePaths.projectPathOf({ path: '/elsewhere/app/thread-1b7a8c', threadDirectories })).toBe('/dev/app')
    expect(WorkspacePaths.projectPathOf({ path: '/dev/app-threads/thread-1b7a8c', threadDirectories })).toBe('/dev/app')
  })

  test('answers no directories without a provider, so only the default layout applies', async () => {
    host = await createTestHost()
    const ctx = host.ctx

    const threadDirectories = await Effect.runPromise(loadThreadDirectories({ ctx, packageId: '@dshfiles/thread-sidebar', projectPaths: ['/dev/app'] }))

    expect(threadDirectories.size).toBe(0)
    expect(WorkspacePaths.projectPathOf({ path: '/elsewhere/app/thread-1b7a8c', threadDirectories })).toBe('/elsewhere/app/thread-1b7a8c')
    expect(WorkspacePaths.projectPathOf({ path: '/dev/app-threads/thread-1b7a8c', threadDirectories })).toBe('/dev/app')
  })
})
