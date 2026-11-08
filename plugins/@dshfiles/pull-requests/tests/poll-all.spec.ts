import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { HostContext } from '@dshfiles/dshx/effect/host-context'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { GhCommandFailed, GitHubCli } from '../src/github-cli.js'
import { PullRequestMonitor } from '../src/monitor.js'
import type { GitHubPullRequestView, PullRequestRecord } from '../src/pull-request-model.js'
import { PullRequestStore } from '../src/store.js'

const PACKAGE_ID = '@dshfiles/pull-requests'

const view: GitHubPullRequestView = {
  state: 'OPEN',
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: 'APPROVED',
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'unit', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  comments: [],
  reviews: [],
}

/** Every poll of this pull request fails, and it sorts before `acme/third#9` so a skipped tail would show. */
const failingPullRequest = 'acme/other#8'

const record = (input: { readonly repo: string; readonly number: number; readonly sessionId: string }): PullRequestRecord => ({
  id: `${encodeURIComponent(input.sessionId)}::${input.repo.toLowerCase()}#${String(input.number)}`,
  sessionId: input.sessionId,
  repo: input.repo,
  number: input.number,
  url: `https://github.com/${input.repo}/pull/${String(input.number)}`,
  cwd: '/work/widget',
  watching: true,
  lastKnownState: null,
  lastCheckedAt: null,
  retryAfterAt: null,
  consecutiveRateLimits: 0,
  lastError: null,
})

const fakeGitHub = (polls: string[]) =>
  Layer.succeed(
    GitHubCli,
    GitHubCli.of({
      repositoryName: () => Effect.die('repositoryName is not used here'),
      pullRequest: input =>
        Effect.suspend(() => {
          const key = `${input.repo}#${String(input.number)}`
          polls.push(key)
          return key === failingPullRequest
            ? Effect.fail(new GhCommandFailed({ operation: 'pr-view', rateLimited: false, exitCode: 1, detail: 'boom' }))
            : Effect.succeed(view)
        }),
      authStatus: Effect.die('authStatus is not used here'),
      repositoryInfo: () => Effect.die('repositoryInfo is not used here'),
      openPullRequestFor: () => Effect.die('openPullRequestFor is not used here'),
      createPullRequest: () => Effect.die('createPullRequest is not used here'),
    }),
  )

const withStorageHost = <A, E, R>(use: (host: Awaited<ReturnType<typeof createTestHost>>) => Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const storageRoot = yield* Effect.promise(() => mkdtemp(join(tmpdir(), 'pull-requests-poll-all-')))
      const mounted = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const host = await createTestHost()
          await host.ctx.plugin(Storage)
          await host.ctx.plugin(StorageJson, { root: storageRoot })
          await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
          return host
        }),
        host => Effect.promise(() => host.dispose()),
      )
      return yield* use(mounted).pipe(Effect.ensuring(Effect.promise(() => rm(storageRoot, { recursive: true, force: true }))))
    }),
  )

describe('pull-requests pollAll', () => {
  it.effect('polls each unique pull request once and keeps polling after a failing target', () =>
    withStorageHost(host => {
      const polls: string[] = []
      const hostContext = HostContext.of({ ctx: host.ctx, packageId: PACKAGE_ID })
      const layer = PullRequestMonitor.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(PullRequestStore.layer, fakeGitHub(polls)).pipe(
            Layer.provideMerge(Layer.mergeAll(StorageDomain.layer, HostApis.layer).pipe(Layer.provide(Layer.succeed(HostContext, hostContext)))),
          ),
        ),
      )

      return Effect.gen(function* () {
        const store = yield* PullRequestStore
        const monitor = yield* PullRequestMonitor
        const seeded = [
          record({ repo: 'acme/widget', number: 7, sessionId: 'session-a' }),
          record({ repo: 'acme/widget', number: 7, sessionId: 'session-b' }),
          record({ repo: 'acme/widget', number: 7, sessionId: 'session-c' }),
          record({ repo: 'acme/other', number: 8, sessionId: 'session-d' }),
          record({ repo: 'acme/third', number: 9, sessionId: 'session-e' }),
        ]
        for (const link of seeded) yield* store.upsert(link)

        yield* monitor.pollAll

        expect(polls.sort()).toEqual([failingPullRequest, 'acme/third#9', 'acme/widget#7'])

        const stored = yield* store.list()
        expect(stored).toHaveLength(seeded.length)

        const shared = stored.filter(link => link.repo === 'acme/widget')
        expect(shared).toHaveLength(3)
        for (const link of shared) {
          expect(link.lastKnownState?.state).toBe('OPEN')
          expect(link.lastKnownState?.checks).toHaveLength(1)
          expect(link.lastCheckedAt).not.toBeNull()
          expect(link.lastError).toBeNull()
        }

        const failed = stored.find(link => link.repo === 'acme/other')
        expect(failed?.lastKnownState).toBeNull()
        expect(failed?.lastError).toBe('gh-command-failed')
        expect(failed?.lastCheckedAt).not.toBeNull()
        expect(failed?.watching).toBe(true)

        const afterFailure = stored.find(link => link.repo === 'acme/third')
        expect(afterFailure?.lastKnownState?.state).toBe('OPEN')
        expect(afterFailure?.lastError).toBeNull()
      }).pipe(Effect.provide(layer))
    }),
  )
})
